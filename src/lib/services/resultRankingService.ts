import { FundingCall } from './fundingCallsService';

interface RankingOptions {
  prioritizeRecent?: boolean;
  prioritizeDeadlines?: boolean;
  favoredApplicantTypes?: string[];
  favoredGrantTypes?: string[];
  favoredCountries?: string[];
  userResearchAreas?: string[];
  boostFactors?: {
    similarity?: number;
    recency?: number;
    deadline?: number;
    applicationMatch?: number;
    grantTypeMatch?: number;
    countryMatch?: number;
    researchAreaMatch?: number;
  };
}

interface RankedResult {
  fundingCall: FundingCall;
  score: number;
  scoreComponents: {
    similarityScore: number;
    recencyScore: number;
    deadlineScore: number;
    applicationTypeScore: number;
    grantTypeScore: number;
    countryScore: number;
    researchAreaScore: number;
  };
}

/**
 * Service for ranking and sorting funding call search results
 */
export class ResultRankingService {
  private defaultBoostFactors = {
    similarity: 1.0,    // Vector similarity is the base score
    recency: 0.3,       // Recency of funding call
    deadline: 0.5,      // Urgency based on deadline
    applicationMatch: 0.4, // Match with preferred applicant types
    grantTypeMatch: 0.4,  // Match with preferred grant types
    countryMatch: 0.5,    // Match with user's country
    researchAreaMatch: 0.6 // Match with user's research areas
  };

  /**
   * Rank a list of funding calls based on various factors
   * @param fundingCalls The funding calls to rank
   * @param similarities The similarity scores from vector search (if available)
   * @param options Ranking options and boost factors
   * @returns The ranked results
   */
  rankResults(
    fundingCalls: FundingCall[], 
    similarities?: number[],
    options: RankingOptions = {}
  ): RankedResult[] {
    // Use default boost factors if not provided
    const boostFactors = {
      ...this.defaultBoostFactors,
      ...options.boostFactors
    };
    
    // Calculate scores for each funding call
    const rankedResults: RankedResult[] = fundingCalls.map((call, index) => {
      // Base similarity score (from vector search or default to 0.5)
      const similarityScore = similarities?.[index] || 0.5;
      
      // Calculate recency score (newer calls get higher scores)
      const recencyScore = this.calculateRecencyScore(call.createdAt);
      
      // Calculate deadline score (closer deadlines get higher scores)
      const deadlineScore = options.prioritizeDeadlines 
        ? this.calculateDeadlineScore(call.deadline)
        : 0.5;
      
      // Calculate applicant type match score
      const applicationTypeScore = options.favoredApplicantTypes
        ? this.calculateMatchScore(call.applicantTypes, options.favoredApplicantTypes)
        : 0.5;
      
      // Calculate grant type match score  
      const grantTypeScore = options.favoredGrantTypes
        ? this.calculateMatchScore(call.grantTypes, options.favoredGrantTypes)
        : 0.5;
      
      // Calculate country match score
      const countryScore = options.favoredCountries
        ? this.calculateCountryScore(call, options.favoredCountries)
        : 0.5;
      
      // Calculate research area match score
      const researchAreaScore = options.userResearchAreas
        ? this.calculateMatchScore(call.researchAreas, options.userResearchAreas)
        : 0.5;
      
      // Calculate the weighted composite score
      const compositeScore = 
        similarityScore * boostFactors.similarity +
        recencyScore * boostFactors.recency +
        deadlineScore * boostFactors.deadline +
        applicationTypeScore * boostFactors.applicationMatch +
        grantTypeScore * boostFactors.grantTypeMatch +
        countryScore * boostFactors.countryMatch +
        researchAreaScore * boostFactors.researchAreaMatch;
      
      // Normalize to a 0-1 range
      const totalBoost = 
        boostFactors.similarity + 
        boostFactors.recency + 
        boostFactors.deadline +
        boostFactors.applicationMatch +
        boostFactors.grantTypeMatch +
        boostFactors.countryMatch +
        boostFactors.researchAreaMatch;
        
      const normalizedScore = compositeScore / totalBoost;
      
      return {
        fundingCall: call,
        score: normalizedScore,
        scoreComponents: {
          similarityScore,
          recencyScore,
          deadlineScore,
          applicationTypeScore,
          grantTypeScore,
          countryScore,
          researchAreaScore
        }
      };
    });
    
    // Sort results by score (descending)
    return rankedResults.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Calculate a score based on how recently the funding call was added
   * @param createdAt The date the funding call was created
   * @returns A score between 0 and 1 (higher for newer calls)
   */
  private calculateRecencyScore(createdAt: Date): number {
    const now = new Date();
    const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    
    // Newer calls (less than 30 days old) get higher scores
    if (ageInDays <= 30) {
      return 1.0 - (ageInDays / 30) * 0.5; // Score between 0.5 and 1.0
    }
    
    // Older calls get lower but still positive scores
    return Math.max(0.1, 0.5 - (ageInDays - 30) / 180); // Bottom out at 0.1
  }
  
  /**
   * Calculate a score based on deadline proximity
   * @param deadline The deadline date (if any)
   * @returns A score between 0 and 1 (higher for closer deadlines)
   */
  private calculateDeadlineScore(deadline: Date | null): number {
    if (!deadline) return 0.5; // No deadline, neutral score
    
    const now = new Date();
    
    // If deadline has passed, lowest score
    if (deadline < now) return 0.1;
    
    const daysUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    // Very close deadlines (within 14 days) get highest score
    if (daysUntilDeadline <= 14) {
      return 1.0;
    }
    
    // Deadlines within 1-3 months get high-medium scores
    if (daysUntilDeadline <= 90) {
      return 0.8 - ((daysUntilDeadline - 14) / 76) * 0.3; // Score between 0.5 and 0.8
    }
    
    // Distant deadlines get lower but still positive scores
    return Math.max(0.3, 0.5 - (daysUntilDeadline - 90) / 275); // Bottom out at 0.3
  }
  
  /**
   * Calculate a match score between two arrays of strings
   * @param sourceArray The source array (from funding call)
   * @param targetArray The target array (user preferences)
   * @returns A score between 0 and 1 based on overlap
   */
  private calculateMatchScore(sourceArray: string[], targetArray: string[]): number {
    if (!sourceArray.length || !targetArray.length) return 0.5;
    
    // Normalize strings for case-insensitive comparison
    const normalizedSource = sourceArray.map(s => s.toLowerCase());
    const normalizedTarget = targetArray.map(s => s.toLowerCase());
    
    // Count exact matches
    const exactMatches = normalizedTarget.filter(t => normalizedSource.includes(t)).length;
    
    // Calculate partial matches for terms that contain each other
    let partialMatches = 0;
    for (const target of normalizedTarget) {
      for (const source of normalizedSource) {
        // Skip exact matches already counted
        if (source === target) continue;
        
        // Check if one contains the other
        if (source.includes(target) || target.includes(source)) {
          partialMatches += 0.5;
        }
      }
    }
    
    const totalMatches = exactMatches + partialMatches;
    const maxPossibleMatches = Math.max(normalizedSource.length, normalizedTarget.length);
    
    // Calculate score with a minimum of 0.2
    return Math.max(0.2, totalMatches / maxPossibleMatches);
  }
  
  /**
   * Calculate a country match score considering both country availability and eligible applicant countries
   * @param call The funding call
   * @param userCountries The user's countries
   * @returns A score between 0 and 1 based on country matches
   */
  private calculateCountryScore(call: FundingCall, userCountries: string[]): number {
    const normalizedUserCountries = userCountries.map(c => c.toLowerCase());
    
    // Check for direct matches in both country arrays
    const availabilityMatches = call.countryAvailability
      .filter(c => normalizedUserCountries.includes(c.toLowerCase())).length;
    
    const eligibilityMatches = call.eligibleApplicantCountries
      .filter(c => normalizedUserCountries.includes(c.toLowerCase())).length;
    
    // If we have matches in either array, return a high score
    if (availabilityMatches > 0 || eligibilityMatches > 0) {
      return 1.0;
    }
    
    // Check for global/all countries indicators
    const globalTerms = ['all', 'global', 'any', 'international', 'worldwide'];
    const hasGlobalAvailability = call.countryAvailability.some(c => 
      globalTerms.includes(c.toLowerCase()));
    
    const hasGlobalEligibility = call.eligibleApplicantCountries.some(c => 
      globalTerms.includes(c.toLowerCase()));
    
    // If the call is available globally, return a medium-high score
    if (hasGlobalAvailability || hasGlobalEligibility) {
      return 0.8;
    }
    
    // No match, return a low but non-zero score
    return 0.2;
  }
}

// Export a singleton instance
export const resultRankingService = new ResultRankingService();

// Re-export the FundingCall interface for convenience
export type { FundingCall } from './fundingCallsService'; 
