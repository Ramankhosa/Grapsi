// @ts-nocheck
import { generateFromOpenAI } from '../openaiService';
import { generateFromGemini, generateFromGeminiWithFiles } from '../geminiService';
import { normalizeStringArray, parseReviewerScore } from '@/lib/reviewer/content';
import axios from 'axios';

export interface ReviewSummary {
  title: string;
  version: number;
  content: string;
  review_json: any;
  context_summary?: string;
}

export class ReviewerService {
  /**
   * Generate a section review using an AI model
   */
  async generateSectionReview(
    sectionTitle: string,
    sectionContent: string,
    callTitle: string,
    callDescription: string,
    modelType: 'O' | 'G' = 'G' // Default to Gemini
  ) {
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${callTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage, acknowledging justified uncertainty in early-stage research if supported by a clear rationale.`;

    const userPrompt = `I need you to review the following section of a grant proposal titled "${callTitle}".

Section: ${sectionTitle}
${callDescription ? `Call Description: ${callDescription}` : ''}

Content:
${sectionContent}

Please provide a comprehensive review with the following components:
1. Score (between 1.0-10.0, with 10 being excellent)
2. Summary evaluation (1-2 paragraphs)
3. Strengths (3-5 bullet points)
4. Weaknesses (3-5 bullet points)
5. Specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed)

Format your response as a JSON object with these keys: score, summary, strengths, weaknesses, recommendations.
Ensure all text values are properly escaped for JSON.`;

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for advanced section review
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields
      return {
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        recommendations: reviewJson.recommendations || reviewJson.suggestions || [],
        suggestions: reviewJson.suggestions || reviewJson.recommendations || []
      };
    } catch (error) {
      console.error('Error parsing LLM response:', error);
      throw new Error('Failed to parse section review response');
    }
  }

  /**
   * Generate an abstract section review using the special scoring criteria
   */
  async generateAbstractReview(
    abstractContent: string,
    proposalTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    console.log(`Generating abstract review using model type: ${modelType}`);
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${proposalTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.`;

    let userPrompt: string;
    
    if (isRevision) {
      userPrompt = `You are reviewing a revised version of the abstract for a grant proposal titled "${proposalTitle}". 

FUNDING CALL CONTEXT:
${callSummary}

ORIGINAL ABSTRACT:
${previousVersion?.content}

PREVIOUS REVIEW:
${JSON.stringify(previousVersion?.review, null, 2)}

REVISED ABSTRACT:
${abstractContent}

Evaluate if the revised abstract has addressed the weaknesses and suggestions from the previous review. Your evaluation should focus on:

1. Clarity and conciseness: Is the abstract clear, concise, and well-structured?
2. Problem definition: Does it clearly state the problem being addressed?
3. Objectives and scope: Are the objectives and scope of the project clearly defined?
4. Innovation and significance: Does it convey the innovation and significance of the proposed work?
5. Alignment with call: Does it align with the funding call priorities?
6. Specific recommendations with examples, recommended responses for improvement (3-5 bullet points but can be more if needed)

IMPORTANT: You must respond ONLY with valid JSON following this exact format without ANY explanation or markdown formatting:

{
  "section_title": "Abstract",
  "proposal_title": "${proposalTitle}",
  "call_summary": "${callSummary}",
  "section_score": (number between 1.0-10.0),
  "score_breakdown": {
    "clarity_and_conciseness": (number between 0.0-2.0),
    "problem_definition": (number between 0.0-2.0),
    "objectives_and_scope": (number between 0.0-2.0),
    "innovation_and_significance": (number between 0.0-2.0),
    "alignment_with_call": (number between 0.0-2.0)
  },
  "section_summary": "1-2 paragraph evaluation summary that includes whether this revision shows improvement over the previous version",
  "section_strengths": ["strength 1", "strength 2", ...],
  "section_weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions_for_improvement": ["suggestion 1", "suggestion 2", ...]
}`;
    } else {
      userPrompt = `Review the following abstract for a grant proposal titled "${proposalTitle}".

FUNDING CALL CONTEXT:
${callSummary}

ABSTRACT:
${abstractContent}

Evaluate the abstract based on the following criteria:

1. Clarity and conciseness: Is the abstract clear, concise, and well-structured?
2. Problem definition: Does it clearly state the problem being addressed?
3. Objectives and scope: Are the objectives and scope of the project clearly defined?
4. Innovation and significance: Does it convey the innovation and significance of the proposed work?
5. Alignment with call: Does it align with the funding call priorities?
6. Provide specific recommendations with examples, recommended responses for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

IMPORTANT: You must respond ONLY with valid JSON following this exact format without ANY explanation or markdown formatting:

{
  "section_title": "Abstract",
  "proposal_title": "${proposalTitle}",
  "call_summary": "${callSummary}",
  "section_score": (number between 1.0-10.0),
  "score_breakdown": {
    "clarity_and_conciseness": (number between 0.0-2.0),
    "problem_definition": (number between 0.0-2.0),
    "objectives_and_scope": (number between 0.0-2.0),
    "innovation_and_significance": (number between 0.0-2.0),
    "alignment_with_call": (number between 0.0-2.0)
  },
  "section_summary": "1-2 paragraph evaluation summary",
  "section_strengths": ["strength 1", "strength 2", ...],
  "section_weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions_for_improvement": ["suggestion 1", "suggestion 2", ...]
}`;
    }

    try {
      let responseText: string;
      
      if (modelType === 'O') {
        responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
      } else {
        responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
      }
      
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      return reviewJson;
    } catch (error) {
      console.error('Error parsing abstract review:', error);
      throw new Error('Failed to parse abstract review response');
    }
  }

  /**
   * Compare an original and revised section
   */
  async compareRevision(
    sectionTitle: string,
    originalContent: string,
    revisedContent: string,
    originalReview: any,
    modelType: 'O' | 'G' = 'G'
  ) {
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies. Your task is to analyze how a grant proposal section has been revised based on previous feedback. 

Maintain the following personality and reviewer stance throughout your evaluation:

- Be analytical and rigorous: Dissect the changes with precision, comparing before and after.
- Be constructive, not just critical: Note improvements but also identify any remaining issues.
- Be impact-focused: Evaluate if revisions enhance the proposal's impact and value.
- Be neutral and professional: Provide firm but respectful feedback in a structured, academic tone.
- Be evidence-seeking: Look for specific improvements in details, justification, and clarity.`;

    const userPrompt = `I need you to compare the original and revised versions of a grant proposal section titled "${sectionTitle}" and evaluate how well the revisions address the previous review.

ORIGINAL CONTENT:
${originalContent}

PREVIOUS REVIEW:
${JSON.stringify(originalReview, null, 2)}

REVISED CONTENT:
${revisedContent}

Please provide a detailed analysis in JSON format with the following structure:

1. score: A numeric score between 1.0-10.0 (with 10 being excellent)
2. improvement_summary: A 1-paragraph summary of how the revisions have improved or not improved the section
3. key_changes: 3-5 bullet points identifying the main changes made
4. improvements: 3-5 bullet points highlighting specific improvements
5. remaining_issues: 0-3 bullet points noting unaddressed or new issues
6. further_recommendations: 0-3 bullet points suggesting additional improvements
7. is_significant_improvement: A boolean (true/false) indicating whether the revision shows substantial improvement

Return your analysis strictly as a JSON object with these keys. Do not include any additional commentary outside the JSON.`;

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for revision comparison
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields with proper defaults
      return {
        score: parseReviewerScore(reviewJson.score),
        improvement_summary: reviewJson.improvement_summary || "No improvement summary provided.",
        key_changes: reviewJson.key_changes || [],
        improvements: reviewJson.improvements || [],
        remaining_issues: reviewJson.remaining_issues || [],
        further_recommendations: reviewJson.further_recommendations || [],
        is_significant_improvement: !!reviewJson.is_significant_improvement
      };
    } catch (error) {
      console.error('Error parsing LLM response:', error);
      throw new Error('Failed to parse revision comparison response');
    }
  }

  /**
   * Generate an overall review of the proposal based on all section reviews
   */
  async generateOverallReview(
    callTitle: string,
    callDescription: string,
    sectionSummaries: ReviewSummary[],
    modelType: 'O' | 'G' = 'G'
  ) {
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${callTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how the sections connect and form a coherent whole. Look for consistency in approach, terminology, and goals across sections.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information (e.g., budget, methodology, or impact) is a significant weakness.

Do not be lenient for weak proposals. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Your task is to provide a comprehensive evaluation of an entire grant proposal based on the reviews of its individual sections.`;

    // Start building the user prompt
    let userPrompt = `I need you to generate a comprehensive overall review for a grant proposal titled "${callTitle}".
${callDescription ? `Call Description: ${callDescription}` : ''}

The proposal consists of the following sections, each with its own review:
`;

    // Add each section's context summary and review data
    sectionSummaries.forEach(section => {
      userPrompt += `\n## ${section.title} (Version ${section.version})
Context Summary: ${section.context_summary || 'Not available'}
Score: ${section.review_json.score || 'N/A'}
Key Points: ${section.review_json.summary || 'Not available'}\n`;
      const reminders = [
        ...(Array.isArray(section.review_json.non_scoring_reminders) ? section.review_json.non_scoring_reminders : []),
        ...(Array.isArray(section.review_json.supplementary_materials) ? section.review_json.supplementary_materials : []),
      ].filter(Boolean);
      if (reminders.length > 0) {
        userPrompt += `Non-scoring supplementary reminders: ${reminders.join('; ')}\n`;
      }
    });

    userPrompt += `\nBased on these section reviews, please provide a comprehensive overall evaluation with:
1. Overall score (between 1.0-10.0, with 10 being excellent)
2. Executive summary (2-3 paragraphs)
3. Major strengths across the proposal (4-6 bullet points)
4. Major weaknesses across the proposal (4-6 bullet points)
5. Cross-sectional recommendations with examples, model responses, etc. for improvement (4-6 bullet points but can be more if needed)
6. Recommended supplementary materials the user should arrange outside the reviewed draft (attachments, budget forms, CVs, support letters, ethics approvals, declarations, signatures, portal uploads). These are reminders only and must not reduce the score.

Return your response strictly in JSON format with the following structure:

{
  "overall_score": 8.5,
  "executive_summary": "This is a well-written proposal...",
  "major_strengths": [
    "Clear problem statement with strong supporting evidence",
    "Innovative methodology that advances current approaches",
    "Strong alignment between objectives and expected outcomes"
  ],
  "major_weaknesses": [
    "Budget justification lacks detail for equipment costs",
    "Timeline appears overly optimistic for the scope of work"
  ],
  "cross_sectional_recommendations": [
    "Provide more detailed budget justification for equipment",
    "Revise timeline to be more realistic given the project complexity"
  ],
  "supplementary_materials": [
    "Attach the completed budget workbook required by the funder",
    "Include CVs or biosketches for key personnel"
  ]
}`;

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI with explicit JSON response format
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for overall review generation
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields
      return {
        overall_score: parseReviewerScore(reviewJson.overall_score),
        executive_summary: reviewJson.executive_summary || "No executive summary provided.",
        major_strengths: normalizeStringArray(reviewJson.major_strengths),
        major_weaknesses: normalizeStringArray(reviewJson.major_weaknesses),
        cross_sectional_recommendations: normalizeStringArray(reviewJson.cross_sectional_recommendations),
        supplementary_materials: normalizeStringArray(reviewJson.supplementary_materials)
      };
    } catch (error) {
      console.error('Error parsing LLM response for overall review:', error);
      throw new Error('The reviewer model returned an invalid final review. Please retry.');
    }
  }
  
  /**
   * Safe JSON parsing with error handling and sanitization
   */
  private safeJsonParse(text: string): any | null {
    try {
      // Fix common issues before attempting to parse
      const sanitized = text
        .replace(/(\w+):"/g, '"$1":"')   // fix unquoted keys
        .replace(/:"([^"]*?):([^"]*?)"/g, (match) => {
          return match.replace(/:/g, ' - '); // replace : inside quoted values
        })
        .replace(/\n/g, "\\n")            // escape newlines
        .replace(/"|"/g, '"')             // fix curly quotes
        .replace(/'|'/g, "'")             // fix apostrophes
        .replace(/\s*\\\s*"/g, '\\"');    // fix escaped quotes

      return JSON.parse(sanitized);
    } catch (e) {
      console.error("Safe parse failed:", e);
      return null;
    }
  }
  
  /**
   * Pre-process JSON content to fix common issues with array formatting
   */
  private preprocessJsonContent(content: string): string {
    if (!content) return "{}";
    
    let processed = content;
    
    // Fix array entries that are raw strings with brackets and quotes
    // Example: [ "text" ] -> ["text"]
    processed = processed.replace(/\[\s*"\s*([^"]*)\s*"\s*\]/g, '["$1"]');
    
    // Fix array entries that start with brackets and quotes
    // Example: [ "**Recommendation -> ["Recommendation
    processed = processed.replace(/\[\s*"\s*(\*\*|\[|\{)?/g, '["');
    
    // Fix array entries that end with brackets and quotes
    // Example: Recommendation**" ] -> Recommendation"]
    processed = processed.replace(/(\*\*|\]|\})?\s*"\s*\]/g, '"]');
    
    // Remove markdown bullet points at the beginning of array items
    processed = processed.replace(/"(\s*[-*•]\s*)([^"]*)"/g, '"$2"');
    
    // Remove numbered list markers at the beginning of array items
    processed = processed.replace(/"(\s*\d+\.\s*)([^"]*)"/g, '"$2"');
    
    // Fix common issue with arrays formatted as strings
    // Example: "major_strengths": "["Clear problem statement", "Strong methodology"]"
    processed = processed.replace(/"(major_strengths|major_weaknesses|cross_sectional_recommendations)"\s*:\s*"(\[.*?\])"/g, 
                                 '"$1": $2');
    
    return processed;
  }
  
  /**
   * Process array fields to handle various formats that might be returned by the LLM
   */
  private processArrayField(field: any): string[] {
    if (!field) return [];
    
    // If it's already an array, process each item
    if (Array.isArray(field)) {
      return field.map(item => {
        if (typeof item === 'string') {
          // Clean up the string (remove extra quotes, brackets, etc.)
          return item.replace(/^\s*["'\[\{]+|["'\]\}]+\s*$/g, '')
                     .replace(/^\s*[-*•]\s+/, '') // Remove bullet points
                     .replace(/^\s*\d+\.\s+/, '') // Remove numbered list markers
                     .trim();
        } else if (item && typeof item === 'object') {
          // Handle objects with point/comment structure
          if (item.point) {
            return item.comment ? `${item.point} - ${item.comment}` : item.point;
          } else if (item.text) {
            return item.text;
          } else {
            // Just stringify the object as fallback
            try {
              return JSON.stringify(item);
            } catch (e) {
              return "Invalid item";
            }
          }
        } else {
          return String(item);
        }
      }).filter(Boolean);
    }
    
    // If it's a string that looks like an array representation, try to parse it
    if (typeof field === 'string') {
      // First check if it's a JSON array string
      if (field.trim().startsWith('[') && field.trim().endsWith(']')) {
        try {
          // Try to parse it as JSON
          const parsed = JSON.parse(field);
          if (Array.isArray(parsed)) {
            return this.processArrayField(parsed);
          }
        } catch (e) {
          // If parsing fails, try to split by commas or line breaks
          const cleanedString = field
            .replace(/^\s*\[\s*|\s*\]\s*$/g, '') // Remove surrounding brackets
            .replace(/",\s*"|',\s*'/g, '"|"');    // Replace comma separators with a unique delimiter
          
          return cleanedString.split('"|"')
            .map(s => s.replace(/^\s*["']+|["']+\s*$/g, '').trim()) // Remove quotes and trim
            .filter(Boolean);
        }
      }
      
      // If it's not a JSON array string, try to split by line breaks or bullet points
      return field
        .split(/\n+|•|\*|-|\d+\.\s+/)
        .map(s => s.trim())
        .filter(Boolean);
    }
    
    // If all else fails, return an empty array
    return [];
  }
  
  /**
   * Sanitize JSON string to fix common issues with escaped characters
   */
  private sanitizeJsonString(jsonStr: string): string {
    try {
      if (!jsonStr) return "{}";
      
      // Replace common problematic patterns
      let sanitized = jsonStr;
      
      // Remove any markdown code block markers
      sanitized = sanitized.replace(/```json|```/g, '');
      
      // Trim whitespace
      sanitized = sanitized.trim();
      
      // Fix issue with line breaks at the start of the string causing JSON parse errors
      if (sanitized.startsWith('\n')) {
        sanitized = sanitized.replace(/^\n+/, '');
      }
      
      // Ensure it starts with { and ends with }
      if (!sanitized.startsWith('{')) sanitized = '{' + sanitized;
      if (!sanitized.endsWith('}')) sanitized = sanitized + '}';
      
      // Fix issue with "overall_score":"2.2" format (convert to number if in quotes)
      sanitized = sanitized.replace(/"overall_score"\s*:\s*"([0-9.]+)"/g, '"overall_score":$1');
      
      // Fix nested objects with point/comment structure that might be causing issues
      sanitized = sanitized.replace(/{(\s*)"point"(\s*):(\s*)"([^"]*)"(\s*),(\s*)"comment"(\s*):(\s*)"([^"]*)"(\s*)}/g, 
                                   '"$4 - $9"');
      
      // Fix objects with just point property
      sanitized = sanitized.replace(/{(\s*)"point"(\s*):(\s*)"([^"]*)"(\s*)}/g, '"$4"');
      
      // Fix mid-sentence colons in values that break JSON syntax
      sanitized = sanitized.replace(/: "([^"]*?)(:)([^"]*?)"/g, ': "$1 - $3"');
      
      // Try to detect and fix unescaped quotes within string values
      sanitized = sanitized.replace(/: "([^"]*)(?<!\\)"([^"]*)"([^"]*)"/g, ': "$1\\"$2\\"$3"');
      
      // Fix newlines that aren't properly escaped
      sanitized = sanitized.replace(/([^\\])\n/g, '$1\\n');
      
      // Fix tabs that aren't properly escaped
      sanitized = sanitized.replace(/([^\\])\t/g, '$1\\t');
      
      // Fix trailing commas in arrays and objects
      sanitized = sanitized.replace(/,(\s*[\}\]])/g, '$1');
      
      // Handle unquoted property names
      sanitized = sanitized.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
      
      // Fix missing quotes around string values
      sanitized = sanitized.replace(/:(\s*)([^"{}\[\],\s][^{}\[\],]*[^{}\[\],\s])(\s*[,}])/g, ':"$2"$3');
      
      // Additional cleanup for common formatting issues
      // Remove any trailing commas before closing braces/brackets
      sanitized = sanitized.replace(/,(\s*[\}\]])/g, '$1');
      
      // Ensure property names are quoted
      sanitized = sanitized.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
      
      // Handle special case where there's a JSON prefix like "json" or "JSON:"
      sanitized = sanitized.replace(/^\s*(?:json|JSON):?\s*/, '');
      
      // Fix array string issues
      // Convert ["*text"] to ["text"]
      sanitized = sanitized.replace(/"(\[.*?\*+)(.*?)("\])/g, '"[$2"]');
      
      // Fix issues with array brackets inside strings
      sanitized = sanitized.replace(/"(\[|\]|{|})/g, '"\\$1');
      
      // Fix common issue with arrays containing bullet points or numbered lists
      sanitized = sanitized.replace(/"([-*•]|\d+\.)\s+([^"]*)"/g, '"$2"');
      
      // Fix curly quotes and apostrophes
      sanitized = sanitized.replace(/"|"/g, '"');
      sanitized = sanitized.replace(/'|'/g, "'");
      
      return sanitized;
    } catch (e) {
      console.error('Error sanitizing JSON string:', e);
      return jsonStr; // Return original if sanitization fails
    }
  }
  
  /**
   * Extract structured data from text when JSON parsing fails
   */
  private extractStructuredDataFromText(text: string) {
    // Default values
    let result = {
      overall_score: 3.0,
      executive_summary: "",
      major_strengths: [] as string[],
      major_weaknesses: [] as string[],
      cross_sectional_recommendations: [] as string[]
    };
    
    try {
      // Try to extract overall score
      const scoreMatch = text.match(/overall[_\s]score["\s:]+([0-9.]+)/i);
      if (scoreMatch && scoreMatch[1]) {
        result.overall_score = parseFloat(scoreMatch[1]);
      }
      
      // Try to extract executive summary
      const summaryMatch = text.match(/executive[_\s]summary["\s:]+["']?([^"'\[\]]+)["']?/i);
      if (summaryMatch && summaryMatch[1]) {
        result.executive_summary = summaryMatch[1].trim();
      }
      
      // Process strengths, weaknesses and recommendations by looking for patterns
      const processArrayItems = (text: string, sectionName: string): string[] => {
        const items: string[] = [];
        
        // Try to find the section with array notation
        const sectionRegex = new RegExp(`${sectionName}["\s:]+\\[(.*?)\\]`, 'is');
        const sectionMatch = text.match(sectionRegex);
        
        if (sectionMatch && sectionMatch[1]) {
          // Split by commas, but be careful with nested objects
          const itemsText = sectionMatch[1];
          
          // First try to parse as JSON array if it looks like valid JSON
          try {
            if (itemsText.includes('{') && itemsText.includes('}')) {
              // Try to reconstruct as JSON array
              const jsonArray = JSON.parse(`[${itemsText}]`);
              
              // Process each item
              jsonArray.forEach((item: any) => {
                if (typeof item === 'string') {
                  items.push(item);
                } else if (item && typeof item === 'object') {
                  // Handle objects with point/comment structure
                  if (item.point) {
                    if (item.comment) {
                      items.push(`${item.point} - ${item.comment}`);
                    } else {
                      items.push(item.point);
                    }
                  } else {
                    // Just stringify the object as fallback
                    items.push(JSON.stringify(item));
                  }
                }
              });
              
              return items;
            }
          } catch (e) {
            // If JSON parsing fails, continue with regex approach
          }
          
          // Split by items that look like they're separated by commas
          const splitItems = itemsText.split(/",\s*"|',\s*'/).map(s => s.trim().replace(/^["'\s]+|["'\s]+$/g, ''));
          
          // Add all non-empty items
          splitItems.forEach(item => {
            if (item.trim()) {
              items.push(item.trim());
            }
          });
        }
        
        // If no items found with array notation, try to find bullet points
        if (items.length === 0) {
          const bulletPointRegex = new RegExp(`${sectionName}["\s:]+\\s*([\\s\\S]*?)(?=\\w+["\s:]+|$)`, 'i');
          const bulletMatch = text.match(bulletPointRegex);
          
          if (bulletMatch && bulletMatch[1]) {
            // Look for bullet points or numbered lists
            const bulletPoints = bulletMatch[1].split(/\n\s*[-•*]\s*|\n\s*\d+\.\s*/).filter(Boolean);
            
            bulletPoints.forEach(point => {
              const trimmed = point.trim();
              if (trimmed) {
                items.push(trimmed);
              }
            });
          }
        }
        
        return items;
      };
      
      // Process each section
      result.major_strengths = processArrayItems(text, 'major[_\\s]strengths');
      result.major_weaknesses = processArrayItems(text, 'major[_\\s]weaknesses');
      result.cross_sectional_recommendations = processArrayItems(text, 'cross[_\\s-]?sectional[_\\s]?recommendations');
      
      return result;
    } catch (e) {
      console.error('Error extracting structured data from text:', e);
      return result;
    }
  }

  /**
   * Generate an introduction section review using the special scoring criteria
   */
  async generateIntroductionReview(
    introductionContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    abstractContextSummary?: string, // Add parameter for Abstract context summary
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements with examples, model responses, etc. in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.`;

    let userPrompt: string;
    
    if (isRevision) {
      userPrompt = `You are reviewing a revised version of the Introduction section for a grant proposal titled "${projectTitle}". 

FUNDING CALL CONTEXT:
${callSummary}

${abstractContextSummary ? `ABSTRACT CONTEXT:
${abstractContextSummary}` : ''}

ORIGINAL INTRODUCTION:
${previousVersion?.content}

PREVIOUS REVIEW:
${JSON.stringify(previousVersion?.review, null, 2)}

REVISED INTRODUCTION:
${introductionContent}

Evaluate if the revised introduction has addressed the weaknesses and suggestions from the previous review. Your evaluation should focus on:

1. Problem statement: Is the research problem clearly defined and justified?
2. Background context: Is sufficient context provided to understand the problem's significance?
3. Research gap: Is the gap in current knowledge or practice clearly identified?
4. Alignment with call: Does it align with the funding call priorities?
5. Writing quality: Is it well-written, logically structured, and engaging?
6. Provide specific recommendations with examples, recommended responses for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Return your response strictly in JSON format with the following structure:

{
  "score": (number between 1.0-10.0),
  "summary": "1-2 paragraph evaluation summary that includes whether this revision shows improvement over the previous version",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions": ["suggestion 1", "suggestion 2", ...]
}`;
    } else {
      userPrompt = `Review the following Introduction section for a grant proposal titled "${projectTitle}".

FUNDING CALL CONTEXT:
${callSummary}

${abstractContextSummary ? `ABSTRACT CONTEXT:
${abstractContextSummary}` : ''}

INTRODUCTION:
${introductionContent}

Evaluate the introduction based on the following criteria:

1. Problem statement: Is the research problem clearly defined and justified?
2. Background context: Is sufficient context provided to understand the problem's significance?
3. Research gap: Is the gap in current knowledge or practice clearly identified?
4. Alignment with call: Does it align with the funding call priorities?
5. Writing quality: Is it well-written, logically structured, and engaging?

Return your response strictly in JSON format with the following structure:

{
  "score": (number between 1.0-10.0),
  "summary": "1-2 paragraph evaluation",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions": ["suggestion 1", "suggestion 2", ...]
}`;
    }

    try {
    let responseText: string;
    
    if (modelType === 'O') {
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      return reviewJson;
    } catch (error) {
      console.error('Error parsing introduction review:', error);
      throw new Error('Failed to parse introduction review response');
    }
  }

  /**
   * Generate objectives section review using specialized scoring criteria
   */
  async generateObjectivesReview(
    objectivesContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    // Extract context summaries for Abstract and Introduction if available
    const abstractSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('abstract'))?.context_summary || '';
    
    const introductionSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('introduction'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements with examples, model responses, etc. in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.`;

    let userPrompt: string;
    
    if (isRevision) {
      userPrompt = `You are reviewing a revised version of the Objectives section for a grant proposal titled "${projectTitle}". 

FUNDING CALL CONTEXT:
${callSummary}

${abstractSummary ? `ABSTRACT CONTEXT:
${abstractSummary}` : ''}

${introductionSummary ? `INTRODUCTION CONTEXT:
${introductionSummary}` : ''}

ORIGINAL OBJECTIVES:
${previousVersion?.content}

PREVIOUS REVIEW:
${JSON.stringify(previousVersion?.review, null, 2)}

REVISED OBJECTIVES:
${objectivesContent}

Evaluate if the revised objectives have addressed the weaknesses and suggestions from the previous review. Your evaluation should focus on:

1. Clarity: Are the objectives clearly stated and specific?
2. Measurability: Are the objectives measurable and achievable within the project scope?
3. Alignment: Do the objectives align with the problem statement and funding call?
4. Logical structure: Are the objectives logically structured and prioritized?
5. Innovation: Do the objectives demonstrate innovation and potential for impact?

Return your response strictly in JSON format with the following structure:

{
  "score": (number between 1.0-10.0),
  "summary": "1-2 paragraph evaluation summary that includes whether this revision shows improvement over the previous version",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions": ["suggestion 1", "suggestion 2", ...]
}`;
    } else {
      userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${abstractSummary ? `- **Abstract**: ${abstractSummary}\n` : ''}
${introductionSummary ? `- **Introduction**: ${introductionSummary}\n` : ''}
` : ''}

### Section Under Review: Objectives

Critically evaluate the **Objectives** section provided below.

Assess the following aspects:
1. Clarity: Are the objectives clearly stated and specific?
2. Measurability: Are the objectives measurable and achievable within the project scope?
3. Alignment: Do the objectives align with the problem statement and funding call?
4. Logical structure: Are the objectives logically structured and prioritized?
5. Innovation: Do the objectives demonstrate innovation and potential for impact?

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional objectives that are clear, specific, measurable, perfectly aligned with the problem statement, and demonstrate high innovation potential.
  - **7–8**: Strong objectives with minor issues in clarity, specificity, or alignment.
  - **5–6**: Adequate objectives that are reasonable but lack specificity, measurability, or clear alignment.
  - **3–4**: Weak objectives with significant gaps, vagueness, or poor alignment with the problem statement.
  - **0–2**: Severely deficient objectives that are vague, unmeasurable, or fail to address the research problem.

### Objectives Content:
${objectivesContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "score": (number between 1.0-10.0),
  "summary": "1-2 paragraph evaluation",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "suggestions": ["suggestion 1", "suggestion 2", ...]
}`;
    }

    try {
      let responseText: string;
      
      if (modelType === 'O') {
        responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
      } else {
        responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
      }
      
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                       
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      return reviewJson;
    } catch (error) {
      console.error('Error parsing objectives review:', error);
      throw new Error('Failed to parse objectives review response');
    }
  }

  /**
   * Generate a literature review section review using specialized scoring criteria
   */
  async generateLiteratureReviewReview(
    literatureReviewContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    // Extract context summaries for Introduction and Objectives if available
    const introductionSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('introduction'))?.context_summary || '';
    
    const objectivesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('objectives'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage, acknowledging justified uncertainty in early-stage research if supported by a clear rationale.`;

    const userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${introductionSummary ? `- **Introduction**: ${introductionSummary}\n` : ''}
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
` : ''}

### Section Under Review: Literature Review

Critically evaluate the **Literature Review** section provided below.

Assess the following aspects:
1. **Comprehensiveness**: Does the review cover the essential literature in the field? Are there significant gaps?
2. **Currency**: Does the review include recent developments and publications in the field?
3. **Critical Analysis**: Does the review critically analyze the literature rather than merely summarize it?
4. **Research Gap Identification**: Does the review clearly identify the gap in knowledge that the proposal aims to address?
5. **Relevance to Objectives**: Is the literature directly relevant to the research objectives?
6. **Organization & Structure**: Is the literature review well-organized by themes, chronology, or methodological approaches?
7. **Citation Quality**: Are citations from reputable, peer-reviewed sources?
${introductionSummary ? `8. **Consistency with Introduction**: Does the literature review build logically from the problem statement in the introduction?` : ''}
${objectivesSummary ? `9. **Support for Objectives**: Does the literature review provide sufficient theoretical or empirical foundation for the stated objectives?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional review that comprehensively analyzes relevant literature, clearly identifies research gaps, and perfectly supports the research objectives.
  - **7–8**: Strong review with minor gaps in coverage, analysis, or connection to objectives.
  - **5–6**: Adequate review that covers basic literature but lacks depth in analysis or clear gap identification.
  - **3–4**: Weak review with significant gaps, limited critical analysis, or poor connection to objectives.
  - **0–2**: Severely deficient review that fails to establish the research context or justify the proposal.

### Literature Review Content:
${literatureReviewContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Literature Review",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for Literature Review
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Literature Review",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        suggestions: reviewJson.suggestions || []
      };
    } catch (error) {
      console.error('Error parsing LLM response for Literature Review:', error);
      throw new Error('Failed to parse literature review response');
    }
  }

  /**
   * Generate a methodology section review using specialized scoring criteria
   */
  async generateMethodologyReview(
    methodologyContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    },
    assetGoogleFileIds?: string[]
  ) {
    // Extract context summaries for relevant sections
    const objectivesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('objectives'))?.context_summary || '';
    
    const literatureReviewSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('literature'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage, acknowledging justified uncertainty in early-stage research if supported by a clear rationale.`;

    let userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
${literatureReviewSummary ? `- **Literature Review**: ${literatureReviewSummary}\n` : ''}
` : ''}

### Section Under Review: Methodology

Critically evaluate the **Methodology** section provided below.

Assess the following aspects:
1. **Appropriateness**: Is the methodology appropriate for addressing the research objectives?
2. **Technical Rigor**: Is the methodology technically sound and described with sufficient detail?
3. **Innovation**: Does the methodology incorporate innovative approaches or techniques?
4. **Feasibility**: Is the methodology feasible given the resources, timeline, and expertise?
5. **Data Collection & Analysis**: Are data collection methods and analytical approaches clearly described and justified?
6. **Limitations & Contingencies**: Does the methodology acknowledge limitations and provide contingency plans?
7. **Ethical Considerations**: Are ethical considerations addressed appropriately?
${objectivesSummary ? `8. **Alignment with Objectives**: Does the methodology directly support the achievement of the stated objectives?` : ''}
${literatureReviewSummary ? `9. **Connection to Literature**: Does the methodology build on approaches identified in the literature review?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional methodology that is innovative, rigorous, well-justified, and perfectly aligned with objectives.
  - **7–8**: Strong methodology with minor issues in detail, justification, or alignment.
  - **5–6**: Adequate methodology that covers basic requirements but lacks depth, innovation, or clear justification.
  - **3–4**: Weak methodology with significant gaps, questionable approaches, or poor alignment with objectives.
  - **0–2**: Severely deficient methodology that is inappropriate, unfeasible, or fails to address the research objectives.

### Methodology Content:
${methodologyContent}

### Output Format
Return your response STRICTLY in JSON format with the following structure:
{
  "section": "Methodology",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation as plain text],
  "strengths": [array of plain text strings, NOT objects or bullets],
  "weaknesses": [array of plain text strings, NOT objects or bullets],
  "suggestions": [array of plain text strings, NOT objects or bullets]
}

IMPORTANT: Each array element must be a simple string without any objects, nested structures, or markdown formatting. Do not use bullet points or numbering in the array elements. Do not include objects with 'point' and 'detail' properties.

Example of CORRECT format:
{
  "strengths": [
    "The methodology clearly describes the experimental design",
    "The data collection approach is comprehensive"
  ]
}

Example of INCORRECT format (DO NOT USE):
{
  "strengths": [
    {"point": "Experimental design", "detail": "The methodology clearly describes it"},
    {"point": "Data collection", "detail": "The approach is comprehensive"}
  ]
}`;

    // Make the linkage between attached assets and the section content explicit
    if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
      userPrompt += `\n\nATTACHED SECTION ASSETS (IMAGES/PDFS): One or more files are attached to this message. Treat these assets as part of the Methodology content. Analyze them together with the text and reference them explicitly where relevant.`;
    }

    let responseText: string;
    if (modelType === 'O') {
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
        responseText = await generateFromGeminiWithFiles(
          [systemPrompt, userPrompt],
          assetGoogleFileIds.map(id => ({ google_file_id: id })),
          'gemini-2.5-pro'
        );
      } else {
        responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
      }
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      let reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Process arrays to ensure they are plain strings
      if (reviewJson.strengths && Array.isArray(reviewJson.strengths)) {
        reviewJson.strengths = reviewJson.strengths.map((item: any) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item !== null) {
            if (item.point) return item.point + (item.detail ? `: ${item.detail}` : '');
            return JSON.stringify(item);
          }
          return String(item);
        });
      }
      
      if (reviewJson.weaknesses && Array.isArray(reviewJson.weaknesses)) {
        reviewJson.weaknesses = reviewJson.weaknesses.map((item: any) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item !== null) {
            if (item.point) return item.point + (item.detail ? `: ${item.detail}` : '');
            return JSON.stringify(item);
          }
          return String(item);
        });
      }
      
      if (reviewJson.suggestions && Array.isArray(reviewJson.suggestions)) {
        reviewJson.suggestions = reviewJson.suggestions.map((item: any) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item !== null) {
            if (item.point) return item.point + (item.detail ? `: ${item.detail}` : '');
            return JSON.stringify(item);
          }
          return String(item);
        });
      }
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Methodology",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        suggestions: reviewJson.suggestions || []
      };
    } catch (error) {
      console.error('Error parsing LLM response for Methodology review:', error);
      throw new Error('Failed to parse methodology review response');
    }
  }

  /**
   * Generate a project timeline section review using specialized scoring criteria
   */
  async generateProjectTimelineReview(
    timelineContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    },
    assetGoogleFileIds?: string[]
  ) {
    // Extract context summaries for Methodology and Objectives if available
    const methodologySummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('methodology'))?.context_summary || '';
    
    const objectivesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('objectives'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage, acknowledging justified uncertainty in early-stage research if supported by a clear rationale.`;

    let userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${methodologySummary ? `- **Methodology**: ${methodologySummary}\n` : ''}
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
` : ''}

### Section Under Review: Project Timeline

Critically evaluate the **Project Timeline** section provided below.

Assess the following aspects:
1. **Clarity & Structure**: Is the timeline clearly presented with specific milestones and deliverables?
2. **Feasibility**: Is the proposed timeline realistic and achievable given the scope of work?
3. **Logical Sequencing**: Are activities sequenced logically with appropriate dependencies?
4. **Resource Allocation**: Is there appropriate allocation of time for different project phases?
5. **Risk Management**: Does the timeline account for potential delays or setbacks?
6. **Alignment with Objectives**: Does the timeline clearly support the achievement of project objectives?
${methodologySummary ? `7. **Consistency with Methodology**: Does the timeline align with the proposed methodological approach?` : ''}
${objectivesSummary ? `8. **Scope Alignment**: Does the timeline cover all activities needed to meet the stated objectives?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional timeline that is comprehensive, realistic, well-structured, and perfectly aligned with objectives and methodology.
  - **7–8**: Strong timeline with minor issues in clarity, feasibility, or alignment.
  - **5–6**: Adequate timeline that covers basic requirements but lacks detail, risk planning, or clear milestones.
  - **3–4**: Weak timeline with significant gaps, unrealistic timeframes, or poor alignment with objectives.
  - **0–2**: Severely deficient timeline that is vague, unfeasible, or fails to demonstrate project planning.

### Project Timeline Content:
${timelineContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Project Timeline",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;

    if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
      userPrompt += `\n\nATTACHED SECTION ASSETS (IMAGES/PDFS): One or more files are attached to this message. Treat these assets as part of the Project Timeline. Interpret milestones, Gantt charts, or schedules in the images together with the text.`;
    }

    let responseText: string;
    if (modelType === 'O') {
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
        responseText = await generateFromGeminiWithFiles(
          [systemPrompt, userPrompt],
          assetGoogleFileIds.map(id => ({ google_file_id: id })),
          'gemini-2.5-pro'
        );
      } else {
        responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
      }
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Project Timeline",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        suggestions: reviewJson.suggestions || []
      };
    } catch (error) {
      console.error('Error parsing LLM response for Project Timeline review:', error);
      throw new Error('Failed to parse project timeline review response');
    }
  }

  /**
   * Generate a budget justification section review using specialized scoring criteria
   */
  async generateBudgetJustificationReview(
    budgetContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    },
    assetGoogleFileIds?: string[]
  ) {
    // Extract context summaries for Methodology and Project Timeline if available
    const methodologySummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('methodology'))?.context_summary || '';
    
    const timelineSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('timeline'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage, acknowledging justified uncertainty in early-stage research if supported by a clear rationale. Pay particular attention to value-for-money and proper justification of all costs.`;

    let userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${methodologySummary ? `- **Methodology**: ${methodologySummary}\n` : ''}
${timelineSummary ? `- **Project Timeline**: ${timelineSummary}\n` : ''}
` : ''}

### Section Under Review: Budget Justification

Critically evaluate the **Budget Justification** section provided below.

Assess the following aspects:
1. **Clarity & Detail**: Is each budget item clearly explained with sufficient detail?
2. **Appropriateness**: Are the requested funds appropriate for the proposed activities?
3. **Cost-Effectiveness**: Does the budget demonstrate value for money and efficient use of resources?
4. **Alignment with Activities**: Does the budget align with the proposed methodology and timeline?
5. **Draft Justification Completeness**: Does the text justify the budget categories it actually discusses?
6. **Compliance within Provided Draft**: Does the text respect funding agency restrictions that are assessable from the draft?
7. **Resource Distribution**: Is there appropriate allocation across budget categories and project phases?
${methodologySummary ? `8. **Resource-Methodology Alignment**: Do the budgeted resources match the methodological needs?` : ''}
${timelineSummary ? `9. **Timeline Consistency**: Does the budget allocation align with the project timeline?` : ''}

Score only the Budget Justification text and any attached assets supplied to this review. Do not reduce the score for missing separate budget workbooks, quotes, invoices, institutional approvals, signatures, portal forms, or other submission materials. Assume those supplementary materials will be arranged by the user and mention them only as reminders.

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional budget justification that is comprehensive, well-justified, cost-effective, and perfectly aligned with project activities.
  - **7–8**: Strong budget justification with minor issues in clarity, justification, or alignment.
  - **5–6**: Adequate budget justification that covers basic requirements but lacks detail, efficiency, or clear alignment.
  - **3–4**: Weak budget justification with significant gaps, unjustified expenses, or poor alignment with activities.
  - **0–2**: Severely deficient budget justification that is vague, unreasonable, or fails to justify expenses.

### Budget Justification Content:
${budgetContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Budget Justification",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions],
  "non_scoring_reminders": [array of non-scoring budget/submission reminders],
  "supplementary_materials": [array of budget materials the user should arrange separately]
}`;

    if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
      userPrompt += `\n\nATTACHED SECTION ASSETS (IMAGES/PDFS): One or more files are attached to this message. Treat these assets as part of the Budget Justification (e.g., tables, invoices, quotes). Use them alongside the text when evaluating costs and rationale.`;
    }

    let responseText: string;
    if (modelType === 'O') {
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      if (assetGoogleFileIds && assetGoogleFileIds.length > 0) {
        responseText = await generateFromGeminiWithFiles(
          [systemPrompt, userPrompt],
          assetGoogleFileIds.map(id => ({ google_file_id: id })),
          'gemini-2.5-pro'
        );
      } else {
        responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
      }
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Budget Justification",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: normalizeStringArray(reviewJson.strengths),
        weaknesses: normalizeStringArray(reviewJson.weaknesses),
        suggestions: normalizeStringArray(reviewJson.suggestions),
        non_scoring_reminders: normalizeStringArray(reviewJson.non_scoring_reminders),
        supplementary_materials: normalizeStringArray(reviewJson.supplementary_materials)
      };
    } catch (error) {
      console.error('Error parsing LLM response for Budget Justification review:', error);
      throw new Error('The reviewer model returned an invalid Budget Justification review. Please retry.');
    }
  }

  /**
   * Generate an expected outcomes section review using specialized scoring criteria
   */
  async generateExpectedOutcomesReview(
    outcomesContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    // Extract context summaries for Objectives and Methodology if available
    const objectivesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('objectives'))?.context_summary || '';
    
    const methodologySummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('methodology'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Challenge vague impact claims and ensure there are concrete deliverables and measurable outcomes that match the stated objectives.`;

    let userPrompt: string;
    
    if (isRevision) {
      userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
${methodologySummary ? `- **Methodology**: ${methodologySummary}\n` : ''}
` : ''}

### Section Under Review: Expected Outcomes (REVISION)

You are reviewing a REVISED version of the Expected Outcomes section. 

ORIGINAL VERSION:
${previousVersion?.content}

PREVIOUS REVIEW:
${JSON.stringify(previousVersion?.review, null, 2)}

REVISED VERSION:
${outcomesContent}

Evaluate if the revised Expected Outcomes section has addressed the weaknesses and suggestions from the previous review. Critically assess the following aspects:

1. **Clarity & Specificity**: Are the expected outcomes clearly articulated and specific?
2. **Significance**: Do the outcomes represent meaningful contributions to the field?
3. **Feasibility**: Are the expected outcomes realistic given the methodology and timeline?
4. **Measurability**: Are the outcomes measurable or otherwise verifiable?
5. **Alignment with Objectives**: Do the outcomes directly address the stated objectives?
6. **Broader Impact**: Do the outcomes demonstrate potential for broader impact?
7. **Innovation**: Do the outcomes reflect innovative or novel contributions?
8. **Improvement**: Has the revision addressed the weaknesses identified in the previous review?
${objectivesSummary ? `9. **Objectives Fulfillment**: Do the outcomes fully satisfy the stated objectives?` : ''}
${methodologySummary ? `10. **Methodology Alignment**: Are the outcomes logically derived from the proposed methodology?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional outcomes that are significant, feasible, clearly articulated, and perfectly aligned with objectives.
  - **7–8**: Strong outcomes with minor issues in clarity, feasibility, or alignment.
  - **5–6**: Adequate outcomes that are reasonable but lack specificity, significance, or clear alignment.
  - **3–4**: Weak outcomes with significant gaps, unrealistic expectations, or poor alignment with objectives.
  - **0–2**: Severely deficient outcomes that are vague, trivial, or fail to address project goals.

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Expected Outcomes",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation that includes whether this revision shows improvement over the previous version],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;
    } else {
      userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
${methodologySummary ? `- **Methodology**: ${methodologySummary}\n` : ''}
` : ''}

### Section Under Review: Expected Outcomes

Critically evaluate the **Expected Outcomes** section provided below.

Assess the following aspects:
1. **Clarity & Specificity**: Are the expected outcomes clearly articulated and specific?
2. **Significance**: Do the outcomes represent meaningful contributions to the field?
3. **Feasibility**: Are the expected outcomes realistic given the methodology and timeline?
4. **Measurability**: Are the outcomes measurable or otherwise verifiable?
5. **Alignment with Objectives**: Do the outcomes directly address the stated objectives?
6. **Broader Impact**: Do the outcomes demonstrate potential for broader impact?
7. **Innovation**: Do the outcomes reflect innovative or novel contributions?
${objectivesSummary ? `8. **Objectives Fulfillment**: Do the outcomes fully satisfy the stated objectives?` : ''}
${methodologySummary ? `9. **Methodology Alignment**: Are the outcomes logically derived from the proposed methodology?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional outcomes that are significant, feasible, clearly articulated, and perfectly aligned with objectives.
  - **7–8**: Strong outcomes with minor issues in clarity, feasibility, or alignment.
  - **5–6**: Adequate outcomes that are reasonable but lack specificity, significance, or clear alignment.
  - **3–4**: Weak outcomes with significant gaps, unrealistic expectations, or poor alignment with objectives.
  - **0–2**: Severely deficient outcomes that are vague, trivial, or fail to address project goals.

### Expected Outcomes Content:
${outcomesContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Expected Outcomes",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;
    }

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for Outcomes Review
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Expected Outcomes",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        suggestions: reviewJson.suggestions || []
      };
    } catch (error) {
      console.error('Error parsing LLM response for Expected Outcomes review:', error);
      throw new Error('Failed to parse expected outcomes review response');
    }
  }

  /**
   * Generate a conclusion section review using specialized scoring criteria
   */
  async generateConclusionReview(
    conclusionContent: string,
    projectTitle: string,
    callSummary: string,
    modelType: 'O' | 'G' = 'G', // Default to Gemini
    relevantContextSummaries?: { section_title: string, context_summary: string }[],
    previousVersion?: {
      content?: string,
      review?: any
    }
  ) {
    // Extract context summaries for key sections if available
    const abstractSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('abstract'))?.context_summary || '';
    
    const objectivesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('objectives'))?.context_summary || '';
    
    const outcomesSummary = relevantContextSummaries?.find(s => 
      s.section_title.toLowerCase().includes('outcome'))?.context_summary || '';
    
    const isRevision = !!previousVersion?.content && !!previousVersion?.review;
    
    const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. For conclusions, ensure it effectively synthesizes the entire proposal and reinforces the key value proposition.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information is a significant weakness—flag it and note its impact on your evaluation.
- Be specific: Provide specific recommendations with examples, model responses, etc. for improvement (3-5 bullet points but can be more if needed),explaining that **why** this change is necessary or beneficial—ideally linking it to evaluation criteria (e.g., clarity, feasibility, alignment, innovation).

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Ensure the conclusion provides a compelling final argument for why this project should be funded.`;

    let userPrompt: string;
    
    if (isRevision) {
      userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${abstractSummary ? `- **Abstract**: ${abstractSummary}\n` : ''}
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
${outcomesSummary ? `- **Expected Outcomes**: ${outcomesSummary}\n` : ''}
` : ''}

### Section Under Review: Conclusion (REVISION)

You are reviewing a REVISED version of the Conclusion section.

ORIGINAL VERSION:
${previousVersion?.content}

PREVIOUS REVIEW:
${JSON.stringify(previousVersion?.review, null, 2)}

REVISED VERSION:
${conclusionContent}

Evaluate if the revised Conclusion section has addressed the weaknesses and suggestions from the previous review. Critically assess the following aspects:

1. **Synthesis & Coherence**: Does the conclusion effectively synthesize the key elements of the proposal?
2. **Alignment with Proposal**: Does the conclusion align with the objectives, methods, and expected outcomes?
3. **Value Proposition**: Does the conclusion clearly articulate the value and significance of the project?
4. **Compelling Case**: Does the conclusion make a compelling case for funding the project?
5. **Future Directions**: Does the conclusion address potential future directions or broader implications?
6. **Completeness**: Does the conclusion provide appropriate closure to the proposal?
7. **Improvement**: Has the revision addressed the weaknesses identified in the previous review?
${abstractSummary ? `8. **Abstract Consistency**: Is the conclusion consistent with the framing established in the abstract?` : ''}
${objectivesSummary ? `9. **Objectives Reaffirmation**: Does the conclusion reaffirm how the project will achieve its objectives?` : ''}
${outcomesSummary ? `10. **Outcomes Reinforcement**: Does the conclusion effectively reinforce the expected outcomes?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional conclusion that masterfully synthesizes the proposal, makes a compelling case, and perfectly aligns with all proposal elements.
  - **7–8**: Strong conclusion with minor issues in synthesis, coherence, or alignment.
  - **5–6**: Adequate conclusion that provides basic closure but lacks synthesis, compelling elements, or clear alignment.
  - **3–4**: Weak conclusion with significant gaps, poor synthesis, or misalignment with proposal elements.
  - **0–2**: Severely deficient conclusion that fails to provide closure or make a case for the project.

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Conclusion",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation that includes whether this revision shows improvement over the previous version],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;
    } else {
      userPrompt = `### Proposal Context
- **Project Title**: ${projectTitle}
- **Funding Agency Call Summary**: ${callSummary}

${relevantContextSummaries && relevantContextSummaries.length > 0 ? `### Context from Previous Sections
${abstractSummary ? `- **Abstract**: ${abstractSummary}\n` : ''}
${objectivesSummary ? `- **Objectives**: ${objectivesSummary}\n` : ''}
${outcomesSummary ? `- **Expected Outcomes**: ${outcomesSummary}\n` : ''}
` : ''}

### Section Under Review: Conclusion

Critically evaluate the **Conclusion** section provided below.

Assess the following aspects:
1. **Synthesis & Coherence**: Does the conclusion effectively synthesize the key elements of the proposal?
2. **Alignment with Proposal**: Does the conclusion align with the objectives, methods, and expected outcomes?
3. **Value Proposition**: Does the conclusion clearly articulate the value and significance of the project?
4. **Compelling Case**: Does the conclusion make a compelling case for funding the project?
5. **Future Directions**: Does the conclusion address potential future directions or broader implications?
6. **Completeness**: Does the conclusion provide appropriate closure to the proposal?
${abstractSummary ? `7. **Abstract Consistency**: Is the conclusion consistent with the framing established in the abstract?` : ''}
${objectivesSummary ? `8. **Objectives Reaffirmation**: Does the conclusion reaffirm how the project will achieve its objectives?` : ''}
${outcomesSummary ? `9. **Outcomes Reinforcement**: Does the conclusion effectively reinforce the expected outcomes?` : ''}

### Scoring Guidelines
- Assign a score out of 10 using the following scale:
  - **9–10**: Exceptional conclusion that masterfully synthesizes the proposal, makes a compelling case, and perfectly aligns with all proposal elements.
  - **7–8**: Strong conclusion with minor issues in synthesis, coherence, or alignment.
  - **5–6**: Adequate conclusion that provides basic closure but lacks synthesis, compelling elements, or clear alignment.
  - **3–4**: Weak conclusion with significant gaps, poor synthesis, or misalignment with proposal elements.
  - **0–2**: Severely deficient conclusion that fails to provide closure or make a case for the project.

### Conclusion Content:
${conclusionContent}

### Output Format
Return your response strictly in JSON format with the following structure:
{
  "section": "Conclusion",
  "score": [number between 1-10],
  "summary": [1-2 paragraph evaluation],
  "strengths": [array of specific strengths],
  "weaknesses": [array of specific weaknesses],
  "suggestions": [array of actionable suggestions]
}`;
    }

    let responseText: string;
    
    if (modelType === 'O') {
      // Use OpenAI
      responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
    } else {
      // Use Gemini 2.5 Pro for Conclusion Review
      responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.5-pro');
    }

    // Parse the response into JSON
    try {
      // Try to extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, responseText];
                      
      const reviewJson = JSON.parse(jsonMatch[1] || responseText);
      
      // Ensure we have all expected fields and normalize the structure
      return {
        section: "Conclusion",
        score: parseReviewerScore(reviewJson.score),
        summary: reviewJson.summary || "No summary provided.",
        strengths: reviewJson.strengths || [],
        weaknesses: reviewJson.weaknesses || [],
        suggestions: reviewJson.suggestions || []
      };
    } catch (error) {
      console.error('Error parsing LLM response for Conclusion review:', error);
      throw new Error('Failed to parse conclusion review response');
    }
  }
} 
