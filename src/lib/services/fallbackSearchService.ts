// Fallback search service for environments without pgvector
import { FundingCall } from './fundingCallsService';
import prisma from '../prisma';

interface SearchFilters {
  applicantTypes?: string[];
  grantTypes?: string[];
  countries?: string[];
  limit?: number;
  includeExpired?: boolean;
}

interface SearchResult {
  results: FundingCall[];
  similarity?: number[];
  error?: string;
}

interface ConversationParams {
  query: string;
  conversationHistory?: string;
}

/**
 * Provides search functionality for funding calls without requiring pgvector
 */
class FallbackSearchService {
  /**
   * Search for funding calls using text-based search
   * @param query The search query
   * @param filters Optional filters
   * @returns Search results
   */
  async searchFundingCalls(query: string, filters: SearchFilters = {}): Promise<SearchResult> {
    try {
      console.log('Using fallback search service (without pgvector)');
      
      // Generate mock funding calls for testing
      // This will allow us to test the UI without a database
      const mockFundingCalls: FundingCall[] = [
        {
          id: '1',
          countryAvailability: ['USA', 'Canada', 'Global'],
          eligibleApplicantCountries: ['USA', 'Canada'],
          applicantTypes: ['Academic', 'Non-profit'],
          grantTypes: ['Research', 'Development'],
          agencyName: 'National Science Foundation',
          schemeTitle: 'Advanced Research Grant 2025',
          description: 'Funding for advanced research projects in various scientific fields.',
          deadline: new Date('2025-12-31'),
          fundingAmount: '$100,000 - $500,000',
          eligibility: 'Academic institutions and qualified researchers',
          researchAreas: ['Computer Science', 'AI', 'Machine Learning'],
          urls: ['https://example.org/grants/arg2025'],
          contactInfo: 'grants@nsf.example.org',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: '2',
          countryAvailability: ['UK', 'EU', 'Global'],
          eligibleApplicantCountries: ['UK', 'EU Countries'],
          applicantTypes: ['Academic', 'Industry'],
          grantTypes: ['Innovation', 'Research'],
          agencyName: 'European Research Council',
          schemeTitle: 'Horizon Innovation Fund',
          description: 'Supporting innovative research with commercial applications.',
          deadline: new Date('2025-10-15'),
          fundingAmount: '€200,000 - €1,000,000',
          eligibility: 'European universities and industry partners',
          researchAreas: ['Engineering', 'Biotechnology', 'Sustainable Energy'],
          urls: ['https://example.org/erc/horizon'],
          contactInfo: 'info@erc.example.eu',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: '3',
          countryAvailability: ['Global'],
          eligibleApplicantCountries: ['Any'],
          applicantTypes: ['Non-profit', 'NGO'],
          grantTypes: ['Social Impact', 'Development'],
          agencyName: 'Global Development Foundation',
          schemeTitle: 'Social Impact Grant Program',
          description: 'Funding for projects addressing global challenges in developing regions.',
          deadline: new Date('2025-09-01'),
          fundingAmount: '$50,000 - $250,000',
          eligibility: 'Non-profit organizations with track record of social impact',
          researchAreas: ['Social Development', 'Public Health', 'Education'],
          urls: ['https://example.org/gdf/impact'],
          contactInfo: 'grants@gdf.example.org',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      // Filter the mock results based on provided filters
      let filteredResults = [...mockFundingCalls];
      
      // Apply filters (simple implementation for demo)
      if (filters.applicantTypes && filters.applicantTypes.length > 0) {
        filteredResults = filteredResults.filter(call => 
          call.applicantTypes.some(type => filters.applicantTypes!.includes(type))
        );
      }
      
      if (filters.grantTypes && filters.grantTypes.length > 0) {
        filteredResults = filteredResults.filter(call => 
          call.grantTypes.some(type => filters.grantTypes!.includes(type))
        );
      }
      
      if (filters.countries && filters.countries.length > 0) {
        filteredResults = filteredResults.filter(call => 
          call.countryAvailability.some(country => 
            country === 'Global' || filters.countries!.includes(country)
          ) ||
          call.eligibleApplicantCountries.some(country => 
            country === 'Any' || filters.countries!.includes(country)
          )
        );
      }
      
      // Apply limit
      if (filters.limit) {
        filteredResults = filteredResults.slice(0, filters.limit);
      }
      
      // Generate mock similarity scores
      const mockSimilarity = filteredResults.map(() => Math.random() * 0.5 + 0.5); // Random scores between 0.5 and 1
      
      return { 
        results: filteredResults,
        similarity: mockSimilarity
      };
    } catch (error) {
      console.error('Error in fallback search:', error);
      return {
        results: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Process a conversation query
   * @param query User query
   * @param conversationHistory Previous conversation history
   * @returns Response message
   */
  async processConversation(query: string, conversationHistory: string = ''): Promise<string> {
    try {
      console.log('Processing conversation in fallback service');
      
      // Detect intent from the query
      const intent = this.detectIntent(query);
      
      switch (intent) {
        case 'greeting':
          return "Hello! I'm your AI funding advisor. How can I help you find suitable grants and funding opportunities today?";
        
        case 'farewell':
          return "Goodbye! Feel free to come back when you need assistance with finding funding opportunities.";
        
        case 'thanks':
          return "You're welcome! Is there anything else you'd like to know about funding opportunities?";
          
        case 'eligibility_question':
          return "Eligibility requirements vary by funding opportunity. To provide specific information, I'd need to know which grant you're interested in. Alternatively, I can search for grants that match your profile if you tell me more about your institution type, research area, and location.";
          
        case 'application_advice':
          return "For a successful grant application, focus on clearly stating your project's objectives, methodology, expected outcomes, and budget. Make sure to align your proposal with the funder's priorities. Would you like me to search for specific funding opportunities that match your research interests?";
          
        case 'funding_amount_question':
          return "Funding amounts vary widely depending on the grant type, research area, and funding agency. To get specific information, I can search for grants in your research area. Could you tell me more about your field of study?";
          
        default:
          // For general queries, provide a helpful response
          return "I'm specialized in helping with funding opportunities. Could you tell me more about your research interests or the type of funding you're looking for? For example, you can ask about grants in specific fields like 'agriculture' or 'artificial intelligence'.";
      }
    } catch (error) {
      console.error('Error in conversation processing:', error);
      return "I apologize, but I encountered an issue processing your question. Could you please try asking in a different way?";
    }
  }
  
  /**
   * Detect the intent of a user query
   * @param query The user query
   * @returns The detected intent
   */
  private detectIntent(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Simple intent detection based on keywords
    if (lowerQuery.match(/\b(hello|hi|hey|greetings)\b/)) {
      return 'greeting';
    }
    
    if (lowerQuery.match(/\b(bye|goodbye|farewell|see you)\b/)) {
      return 'farewell';
    }
    
    if (lowerQuery.match(/\b(thanks|thank you|appreciate)\b/)) {
      return 'thanks';
    }
    
    if (lowerQuery.match(/\b(eligible|eligibility|qualify|who can apply|requirements)\b/)) {
      return 'eligibility_question';
    }
    
    if (lowerQuery.match(/\b(how to apply|application|proposal|submit|tips|advice)\b/)) {
      return 'application_advice';
    }
    
    if (lowerQuery.match(/\b(how much|amount|funding amount|budget|money)\b/)) {
      return 'funding_amount_question';
    }
    
    // Default to general conversation
    return 'general_conversation';
  }
  
  /**
   * Extract keywords from a search query
   * @param query The search query
   * @returns Array of keywords
   */
  private extractKeywords(query: string): string[] {
    // Remove special characters and split by spaces
    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out short words
    
    // Remove common stop words
    const stopWords = ['the', 'and', 'for', 'with', 'that', 'this', 'are', 'from', 'have'];
    return words.filter(word => !stopWords.includes(word));
  }
}

const fallbackSearchService = new FallbackSearchService();
export default fallbackSearchService; 