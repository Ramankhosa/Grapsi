// @ts-nocheck
import { generateFromOpenAI } from './openaiService';
import { generateFromGemini } from './geminiService';

// Define the section order based on the specified review flow
export const SECTION_ORDER = [
  'Abstract',
  'Introduction',
  'Objectives',
  'Literature Review',
  'Methodology',
  'Project Timeline',
  'Budget Justification',
  'Team Expertise',
  'Expected Outcomes',
  'Societal Impact',
  'Sustainability',
  'Risk & Mitigation',
  'IP & Commercialization',
  'Conclusion'
];

// Define dependencies between sections for contextual review
export const SECTION_DEPENDENCIES: Record<string, string[]> = {
  // Abstract depends on nothing (it's usually the first section)
  'abstract': [],
  
  // Introduction depends on Abstract
  'introduction': ['abstract'],
  
  // Literature Review depends on Introduction and Abstract
  'literature_review': ['introduction', 'abstract'],
  
  // Objectives depend on Abstract and Introduction
  'objectives': ['abstract', 'introduction'],
  
  // Methodology depends on Objectives and Literature Review
  'methodology': ['objectives', 'literature_review'],
  
  // Project Timeline depends on Methodology and Objectives
  'timeline': ['methodology', 'objectives'],
  
  // Budget Justification depends on Methodology and Project Timeline
  'budget': ['methodology', 'timeline'],
  
  // Expected Outcomes depends on Objectives and Methodology
  'outcomes': ['objectives', 'methodology'],
  
  // Conclusion depends on Abstract, Objectives, Expected Outcomes, and any Impact sections
  'conclusion': ['abstract', 'objectives', 'outcomes', 'impact'],
  
  // Default dependency is on all previous sections
  'default': []
};

type ReviewInput = {
  section: {
    section_title: string;
    user_input: string;
    is_revision: boolean;
    version: number;
  };
  previousSection?: {
    section_title: string;
    user_input: string;
    ai_review_json: any;
    context_summary?: string;
  } | null;
  contextSection?: {
    section_title: string;
    ai_review_json: any;
    context_summary?: string;
  } | null;
  priorSectionSummaries?: {
    section_title: string;
    context_summary: string;
  }[];
  callData: any;
  modelType: string;
};

type ReviewResult = {
  review: {
    score: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    improvement_over_previous?: boolean;
    context_summary?: string;
  };
  isImprovement: boolean;
};

// Get section position in the logical review flow
export function getSectionPosition(sectionTitle: string): number {
  const normalizedTitle = sectionTitle.trim().toLowerCase();
  
  // Check for exact matches first
  const exactIndex = SECTION_ORDER.findIndex(
    title => title.toLowerCase() === normalizedTitle
  );
  
  if (exactIndex !== -1) return exactIndex;
  
  // Check for partial matches
  for (let i = 0; i < SECTION_ORDER.length; i++) {
    if (normalizedTitle.includes(SECTION_ORDER[i].toLowerCase()) || 
        SECTION_ORDER[i].toLowerCase().includes(normalizedTitle)) {
      return i;
    }
  }
  
  // If no match found, return a high number to place at the end
  return 999;
}

/**
 * Filters context summaries based on section dependencies
 * @param sectionTitle The title of the current section being reviewed
 * @param allContextSummaries All available context summaries
 * @returns Only the context summaries relevant for reviewing the current section
 */
export function filterRelevantContextSummaries(
  sectionTitle: string,
  allContextSummaries: { section_title: string, context_summary: string }[]
): { section_title: string, context_summary: string }[] {
  // Normalize section title for matching
  const normalizedSectionTitle = sectionTitle.toLowerCase();
  
  // Find the matching dependency key
  let dependencyKey = 'default';
  
  // Check for each section type
  if (normalizedSectionTitle.includes('abstract')) {
    dependencyKey = 'abstract';
  } else if (normalizedSectionTitle.includes('introduction') || normalizedSectionTitle.includes('background')) {
    dependencyKey = 'introduction';
  } else if (normalizedSectionTitle.includes('literature') || normalizedSectionTitle.includes('prior work')) {
    dependencyKey = 'literature_review';
  } else if (normalizedSectionTitle.includes('objective') || normalizedSectionTitle.includes('goal')) {
    dependencyKey = 'objectives';
  } else if (normalizedSectionTitle.includes('method') || normalizedSectionTitle.includes('approach')) {
    dependencyKey = 'methodology';
  } else if (normalizedSectionTitle.includes('timeline') || normalizedSectionTitle.includes('schedule')) {
    dependencyKey = 'timeline';
  } else if (normalizedSectionTitle.includes('budget')) {
    dependencyKey = 'budget';
  } else if (normalizedSectionTitle.includes('outcome') || normalizedSectionTitle.includes('result')) {
    dependencyKey = 'outcomes';
  } else if (normalizedSectionTitle.includes('conclusion') || normalizedSectionTitle.includes('summary')) {
    dependencyKey = 'conclusion';
  }
  
  // If we don't have specific dependencies for this section type, return all summaries
  if (dependencyKey === 'default' || !SECTION_DEPENDENCIES[dependencyKey]) {
    return allContextSummaries;
  }
  
  // Get the dependency list for this section
  const dependencies = SECTION_DEPENDENCIES[dependencyKey];
  
  // If no dependencies, return empty array
  if (dependencies.length === 0) {
    return [];
  }
  
  // Filter context summaries based on dependencies
  return allContextSummaries.filter(summary => {
    const normalizedTitle = summary.section_title.toLowerCase();
    
    // Check if this summary's section matches any of the dependencies
    return dependencies.some(dep => {
      if (dep === 'abstract') {
        return normalizedTitle.includes('abstract');
      } else if (dep === 'introduction') {
        return normalizedTitle.includes('introduction') || normalizedTitle.includes('background');
      } else if (dep === 'literature_review') {
        return normalizedTitle.includes('literature') || normalizedTitle.includes('prior work');
      } else if (dep === 'objectives') {
        return normalizedTitle.includes('objective') || normalizedTitle.includes('goal');
      } else if (dep === 'methodology') {
        return normalizedTitle.includes('method') || normalizedTitle.includes('approach');
      } else if (dep === 'timeline') {
        return normalizedTitle.includes('timeline') || normalizedTitle.includes('schedule');
      } else if (dep === 'budget') {
        return normalizedTitle.includes('budget');
      } else if (dep === 'outcomes') {
        return normalizedTitle.includes('outcome') || normalizedTitle.includes('result');
      } else if (dep === 'impact') {
        return normalizedTitle.includes('impact') || normalizedTitle.includes('significance');
      } else {
        return false;
      }
    });
  });
}

/**
 * Reviews a proposal section using the specified LLM
 */
export async function reviewSection(input: ReviewInput): Promise<ReviewResult> {
  const { section, previousSection, contextSection, priorSectionSummaries, callData, modelType } = input;
  const isRevision = section.is_revision && previousSection;
  
  // Get the project title and call summary
  const projectTitle = callData.project_title || callData.title || "Grant Proposal";
  const callSummary = callData.call_summary || callData.agency_name || "Funding opportunity";
  const thrustAreas = Array.isArray(callData.thrust_areas) ? callData.thrust_areas.join(', ') : callData.thrust_areas || 'Not specified';
  
  // Prepare the prompt based on whether this is a revision or new section
  const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities and thematic scope, as provided in the funding call guidelines.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information (e.g., budget, methodology, or impact) is a significant weakness—flag it and note its impact on your evaluation.

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage (e.g., exploratory vs. implementation), acknowledging justified uncertainty in early-stage research if supported by a clear rationale.

You must be professional and precise. You do not guess — cite only what is provided. Return the results in structured JSON.`;

  let userPrompt: string;
  
  // Format prior section summaries if available in a more structured manner
  let priorSummariesText = '';
  if (priorSectionSummaries && priorSectionSummaries.length > 0) {
    priorSummariesText = `### CONTEXT FROM PREVIOUS SECTIONS:

${priorSectionSummaries.map(s => `- **${s.section_title}**: ${s.context_summary}`).join('\n\n')}`;
  }
  
  // Include classic context summary if available (for backward compatibility)
  const contextSummaryText = contextSection?.context_summary && !priorSectionSummaries ? 
    `### CONTEXT FROM PREVIOUS SECTION:
    
- **${contextSection.section_title}**: ${contextSection.context_summary}` : '';
  
  if (isRevision) {
    // For revision reviews
    userPrompt = `You are reviewing a revised version of the [${section.section_title}] section of a grant proposal titled "${projectTitle}". Below is the updated section content, and below that is the AI-generated review of the earlier version.

Evaluate if the user has addressed earlier weaknesses and suggestions. Provide a new review in structured JSON format. Indicate if the revision shows meaningful improvement.

### PROJECT TITLE
${projectTitle}

### FUNDING CALL CONTEXT
${callSummary}
Focus Areas: ${thrustAreas}

${priorSummariesText || contextSummaryText}

### CURRENT SECTION: ${section.section_title}
${section.user_input}

### PREVIOUS AI REVIEW
${JSON.stringify(previousSection?.ai_review_json, null, 2)}

Respond with JSON in the following format:
{
  "score": (number between 1.0-10.0),
  "summary": (1-2 paragraph summary of evaluation),
  "strengths": [(array of specific strengths)],
  "weaknesses": [(array of specific weaknesses)],
  "suggestions": [(array of actionable suggestions for improvement)],
  "improvement_over_previous": (true/false boolean),
  "context_summary": (condensed summary of this section for future LLM use, < 200 tokens)
}`;
  } else {
    // For new section reviews
    userPrompt = `Review the following [${section.section_title}] section of a grant proposal titled "${projectTitle}". Provide a critical evaluation in structured JSON format.

### PROJECT TITLE
${projectTitle}

### FUNDING CALL CONTEXT
${callSummary}
Focus Areas: ${thrustAreas}

${priorSummariesText || contextSummaryText}

### SECTION TO REVIEW: ${section.section_title}
${section.user_input}

${contextSection && !priorSectionSummaries ? `
### PREVIOUS SECTION REVIEW
For context, here's the review of the ${contextSection.section_title} section:
${JSON.stringify(contextSection.ai_review_json, null, 2)}` : ''}

Respond with JSON in the following format:
{
  "score": (number between 1.0-10.0),
  "summary": (1-2 paragraph summary of evaluation),
  "strengths": [(array of specific strengths)],
  "weaknesses": [(array of specific weaknesses)],
  "suggestions": [(array of actionable suggestions for improvement)],
  "context_summary": (condensed summary of this section for future LLM use, < 200 tokens)
}`;
  }

  // Choose the appropriate service based on modelType
  let responseText: string;

  if (modelType === 'O') {
    // Use OpenAI
    responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
  } else {
    // Default to Gemini
    responseText = await generateFromGemini(systemPrompt + '\n\n' + userPrompt, 'gemini-2.0-flash');
  }

  // Parse the response into JSON
  let reviewJson: any;
  try {
    // Try to extract JSON from response (might be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                     responseText.match(/```\n([\s\S]*?)\n```/) ||
                     [null, responseText];
                     
    reviewJson = JSON.parse(jsonMatch[1] || responseText);

    // Ensure we have all expected fields
    reviewJson.score = reviewJson.score || 6.0;
    reviewJson.summary = reviewJson.summary || "No summary provided";
    reviewJson.strengths = reviewJson.strengths || [];
    reviewJson.weaknesses = reviewJson.weaknesses || [];
    
    // Handle both recommendations and suggestions fields for consistency
    if (reviewJson.suggestions && !reviewJson.recommendations) {
      reviewJson.recommendations = reviewJson.suggestions;
    } else if (reviewJson.recommendations && !reviewJson.suggestions) {
      reviewJson.suggestions = reviewJson.recommendations;
    } else if (!reviewJson.suggestions && !reviewJson.recommendations) {
      reviewJson.suggestions = [];
      reviewJson.recommendations = [];
    }
    
    reviewJson.context_summary = reviewJson.context_summary || "Not Available";
    
    // For revisions, determine improvement
    const isImprovement = isRevision ? 
      (reviewJson.improvement_over_previous === true || 
       (reviewJson.score > (previousSection?.ai_review_json?.score || 0))) : 
      false;
    
    if (isRevision) {
      reviewJson.improvement_over_previous = reviewJson.improvement_over_previous === true || isImprovement;
    }

    return {
      review: reviewJson,
      isImprovement: isImprovement
    };
  } catch (error) {
    console.error('Error parsing LLM response:', error);
    // Return a basic review structure in case of error
    return {
      review: {
        score: 6.0,
        summary: "There was an error processing this review. Please try again.",
        strengths: [],
        weaknesses: ["Error in review processing"],
        suggestions: ["Try submitting again"],
        context_summary: "Not Available"
      },
      isImprovement: false
    };
  }
}