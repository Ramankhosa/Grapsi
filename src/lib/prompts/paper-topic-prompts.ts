export type TopicAssistAction =
  | 'refine_question'
  | 'suggest_keywords'
  | 'generate_hypothesis'
  | 'draft_abstract'
  | 'help_formulate_question'
  | 'suggest_all';

export interface TopicAssistContext {
  title?: string | null;
  researchQuestion?: string | null;
  hypothesis?: string | null;
  keywords?: string[] | null;
  methodology?: string | null;
  contributionType?: string | null;
  datasetDescription?: string | null;
  abstractDraft?: string | null;
  paperTypeCode?: string | null;
  // Extended fields for segmented data
  field?: string | null;
  subfield?: string | null;
  topicDescription?: string | null;
  problemStatement?: string | null;
  researchGaps?: string | null;
  methodologyApproach?: string | null;
  expectedResults?: string | null;
  novelty?: string | null;
}

const BASE_RULES = `Rules:
- Output ONLY valid JSON. Do not include code fences or extra commentary.
- If the input is too vague, set the main output field to null and provide 2-4 clarifyingQuestions.
- Use concise academic phrasing.
- Do not invent data or citations.`;

function formatContext(context: TopicAssistContext): string {
  const keywords = Array.isArray(context.keywords) ? context.keywords.join(', ') : '';
  return `Context:
Title: ${context.title || ''}
Field: ${context.field || ''}
Subfield: ${context.subfield || ''}
Topic description: ${context.topicDescription || ''}
Research question: ${context.researchQuestion || ''}
Problem statement: ${context.problemStatement || ''}
Research gaps: ${context.researchGaps || ''}
Hypothesis: ${context.hypothesis || ''}
Methodology: ${context.methodology || ''}
Methodology approach: ${context.methodologyApproach || ''}
Contribution type: ${context.contributionType || ''}
Expected results: ${context.expectedResults || ''}
Novelty: ${context.novelty || ''}
Keywords: ${keywords}
Dataset description: ${context.datasetDescription || ''}
Abstract draft: ${context.abstractDraft || ''}
Paper type: ${context.paperTypeCode || ''}`.trim();
}

export function buildTopicAssistPrompt(action: TopicAssistAction, context: TopicAssistContext): string {
  const contextBlock = formatContext(context);

  switch (action) {
    case 'refine_question':
      return `You are an academic research coach.
${BASE_RULES}

Task: Refine the research question to be specific, measurable, and researchable. Keep it concise.
If the title can be improved, provide a revised title; otherwise return null.

${contextBlock}

Return JSON in this shape:
{
  "researchQuestion": "refined research question or null",
  "title": "improved title or null",
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
    case 'suggest_keywords':
      return `You are an academic research librarian.
${BASE_RULES}

Task: Suggest 6-12 searchable academic keywords based on the context. Use domain-appropriate terminology.

${contextBlock}

Return JSON in this shape:
{
  "keywords": ["keyword 1", "keyword 2"],
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
    case 'generate_hypothesis':
      return `You are an academic research methodologist.
${BASE_RULES}

Task: Generate a testable hypothesis or research proposition aligned with the research question.
If a hypothesis is not appropriate for the methodology, return null and explain via clarifying questions.

${contextBlock}

Return JSON in this shape:
{
  "hypothesis": "hypothesis or null",
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
    case 'draft_abstract':
      return `You are an academic writing assistant.
${BASE_RULES}

Task: Draft a 150-200 word abstract based on the context. Avoid citations. Use formal academic tone.

${contextBlock}

Return JSON in this shape:
{
  "abstractDraft": "draft abstract or null",
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
    case 'help_formulate_question':
      return `You are an academic research mentor helping a beginner researcher.
${BASE_RULES}

Task: Based on the topic description provided, help formulate a clear, focused research question.
Provide 2-4 clarifying questions to help refine the research direction.
Suggest what type of research question would be appropriate (descriptive, comparative, causal, etc.).

${contextBlock}

Return JSON in this shape:
{
  "researchQuestion": "suggested research question or null if more info needed",
  "questionType": "descriptive|comparative|causal|exploratory",
  "clarifyingQuestions": ["question 1", "question 2", "question 3"],
  "suggestions": ["tip 1 for better research question", "tip 2"]
}`;
    case 'suggest_all':
      return `You are a comprehensive academic research assistant.
${BASE_RULES}

Task: Review all provided context and suggest improvements across all aspects:
1. Refine the research question if provided
2. Suggest relevant keywords (6-12)
3. Generate a hypothesis if appropriate
4. Identify any gaps or missing elements
5. Suggest methodology improvements if needed

${contextBlock}

Return JSON in this shape:
{
  "researchQuestion": "refined research question or null",
  "title": "improved title or null",
  "keywords": ["keyword 1", "keyword 2", ...],
  "hypothesis": "suggested hypothesis or null",
  "methodologySuggestions": "suggestions for methodology or null",
  "gaps": ["identified gap 1", "gap 2"],
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
    default:
      return `Unsupported action.`;
  }
}
