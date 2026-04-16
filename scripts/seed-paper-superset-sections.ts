/**
 * Seed Paper Superset Sections and Paper Type Section Prompts
 * 
 * This script populates the database with:
 * 1. PaperSupersetSection - Base section definitions with default prompts
 * 2. PaperTypeSectionPrompt - Paper-type-specific prompt overrides
 * 
 * Run with: npx tsx scripts/seed-paper-superset-sections.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================================================
// BASE PROMPT COMPONENTS
// ============================================================================

const BASE_SYSTEM = `SYSTEM ROLE: You are a senior academic writing assistant.
STYLE: formal, objective, precise, and concise. Avoid marketing language.
OUTPUT: return only the section body without headings or labels.`

const COMMON_CONTEXT = `CONTEXT (use if available):
Title: {{TITLE}}
Research question: {{RESEARCH_QUESTION}}
Hypothesis: {{HYPOTHESIS}}
Methodology: {{METHODOLOGY}}
Contribution type: {{CONTRIBUTION_TYPE}}
Keywords: {{KEYWORDS}}
Dataset description: {{DATASET_DESCRIPTION}}
Abstract draft: {{ABSTRACT_DRAFT}}
Previous sections: {{PREVIOUS_SECTIONS}}`

const CONSTRAINT_REMINDER = 'Follow the constraints block provided in this prompt.'

function buildPrompt(
  sectionName: string,
  instructions: string,
  citationNote: string,
  extraGuidance?: string
): string {
  const guidanceBlock = extraGuidance ? `\n\nADDITIONAL GUIDANCE:\n${extraGuidance}` : ''
  return `${BASE_SYSTEM}\n\nSECTION: ${sectionName}\n\nTASK:\n${instructions}\n\nCITATIONS:\n${citationNote}\n\n${CONSTRAINT_REMINDER}\n\n${COMMON_CONTEXT}${guidanceBlock}`
}

// ============================================================================
// SECTION DEFINITIONS
// ============================================================================

interface SectionDef {
  sectionKey: string
  displayOrder: number
  label: string
  description: string
  instruction: string
  constraints: {
    wordLimit?: number
    citationRequirements?: { minimum: number; recommended: number }
    tenseRequirements?: string[]
    styleRequirements?: string[]
  }
  isRequired: boolean
  requiresBlueprint: boolean
  requiresPreviousSections: boolean
  requiresCitations: boolean
}

interface TypeOverride {
  paperTypeCode: string
  sectionKey: string
  instruction: string
  constraints?: Record<string, any>
}

// Base section definitions
const supersetSections: SectionDef[] = [
  {
    sectionKey: 'abstract',
    displayOrder: 1,
    label: 'Abstract',
    description: 'Concise summary of the entire paper',
    instruction: buildPrompt(
      'Abstract',
      [
        'Summarize the background, problem, method, key findings, and implications.',
        'Write one cohesive paragraph using academic language.',
        'Emphasize the contribution and why it matters.'
      ].join('\n'),
      'Do not include citations.'
    ),
    constraints: {
      wordLimit: 250,
      citationRequirements: { minimum: 0, recommended: 0 },
      tenseRequirements: ['present', 'past'],
      styleRequirements: ['concise', 'formal']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: false,
    requiresCitations: false
  },
  {
    sectionKey: 'introduction',
    displayOrder: 2,
    label: 'Introduction',
    description: 'Context, problem statement, and research objectives',
    instruction: buildPrompt(
      'Introduction',
      [
        'Establish the broader context and importance of the topic.',
        'Identify the specific gap or problem in the literature.',
        'State the research question and objectives clearly.',
        'Preview your approach and expected contributions.',
        'End with a brief roadmap of the paper structure.'
      ].join('\n'),
      'Use citations for background and prior work. Use [CITE:key] only from the provided list. Do not invent citations.'
    ),
    constraints: {
      wordLimit: 1000,
      citationRequirements: { minimum: 5, recommended: 10 },
      tenseRequirements: ['present'],
      styleRequirements: ['formal', 'engaging']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'literature_review',
    displayOrder: 3,
    label: 'Literature Review',
    description: 'Synthesis of existing research and identification of gaps',
    instruction: buildPrompt(
      'Literature Review',
      [
        'Synthesize the literature thematically or methodologically.',
        'Compare key studies, highlight patterns and contradictions.',
        'Identify gaps that motivate the current research.',
        'Establish the theoretical or conceptual foundation.'
      ].join('\n'),
      'Cite extensively using [CITE:key]. Do not invent citations.'
    ),
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 12, recommended: 25 },
      tenseRequirements: ['present'],
      styleRequirements: ['critical', 'synthetic']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'related_work',
    displayOrder: 3,
    label: 'Related Work',
    description: 'Review of related research (conference format)',
    instruction: buildPrompt(
      'Related Work',
      [
        'Focus on the most relevant and recent studies.',
        'Compare approaches and clarify how your work differs.',
        'Identify the specific gap your contribution addresses.',
        'Keep the section concise and focused.'
      ].join('\n'),
      'Use citations for every major comparison. Use [CITE:key] only from the provided list. Do not invent citations.'
    ),
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 6, recommended: 12 },
      tenseRequirements: ['present'],
      styleRequirements: ['focused', 'comparative']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'methodology',
    displayOrder: 4,
    label: 'Methodology',
    description: 'Research design, data collection, and analysis methods',
    instruction: buildPrompt(
      'Methodology',
      [
        'Describe the research design, data collection, and analysis methods.',
        'Include sample characteristics, instruments, and procedures.',
        'Justify methodological choices and address limitations.',
        'Explain ethics or compliance considerations if applicable.'
      ].join('\n'),
      'Cite established methods, instruments, or datasets using [CITE:key]. Do not invent citations.'
    ),
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 5, recommended: 10 },
      tenseRequirements: ['past'],
      styleRequirements: ['precise', 'detailed']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'results',
    displayOrder: 5,
    label: 'Results',
    description: 'Presentation of research findings',
    instruction: buildPrompt(
      'Results',
      [
        'Present findings objectively with clear organization.',
        'Refer to figures or tables when applicable.',
        'Report statistics or qualitative findings without interpretation.'
      ].join('\n'),
      'Use citations only for baseline comparisons or datasets when necessary. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 1200,
      citationRequirements: { minimum: 0, recommended: 2 },
      tenseRequirements: ['past'],
      styleRequirements: ['objective', 'clear']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: false
  },
  {
    sectionKey: 'discussion',
    displayOrder: 6,
    label: 'Discussion',
    description: 'Interpretation of results and implications',
    instruction: buildPrompt(
      'Discussion',
      [
        'Interpret the findings in relation to the research question.',
        'Compare results with prior literature.',
        'Discuss implications, limitations, and future work.',
        'Highlight the contribution and broader significance.'
      ].join('\n'),
      'Use citations for comparisons and implications. Use [CITE:key] only from the provided list. Do not invent citations.'
    ),
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 6, recommended: 15 },
      tenseRequirements: ['present'],
      styleRequirements: ['analytical', 'balanced']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'conclusion',
    displayOrder: 7,
    label: 'Conclusion',
    description: 'Summary of contributions and final thoughts',
    instruction: buildPrompt(
      'Conclusion',
      [
        'Summarize the core findings and contributions.',
        'Emphasize implications and key takeaways.',
        'Avoid introducing new information.'
      ].join('\n'),
      'Citations are optional. If used, rely on [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 600,
      citationRequirements: { minimum: 0, recommended: 3 },
      tenseRequirements: ['present'],
      styleRequirements: ['concise', 'impactful']
    },
    isRequired: true,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: false
  },
  {
    sectionKey: 'acknowledgments',
    displayOrder: 8,
    label: 'Acknowledgments',
    description: 'Recognition of contributions and funding',
    instruction: buildPrompt(
      'Acknowledgments',
      [
        'Acknowledge funding sources, collaborators, and supporting institutions.',
        'Keep the tone professional and concise.'
      ].join('\n'),
      'Do not include citations.'
    ),
    constraints: {
      wordLimit: 150,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['grateful', 'professional']
    },
    isRequired: false,
    requiresBlueprint: false,
    requiresPreviousSections: false,
    requiresCitations: false
  },
  {
    sectionKey: 'future_directions',
    displayOrder: 8,
    label: 'Future Directions',
    description: 'Future research directions for review articles',
    instruction: buildPrompt(
      'Future Directions',
      [
        'Identify promising research directions based on the reviewed literature.',
        'Explain why these directions are important and feasible.',
        'Tie recommendations to the gaps identified in the review.'
      ].join('\n'),
      'Use citations where appropriate. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 3, recommended: 8 },
      tenseRequirements: ['future'],
      styleRequirements: ['forward-looking', 'grounded']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'future_work',
    displayOrder: 9,
    label: 'Future Work',
    description: 'Future work and research extensions',
    instruction: buildPrompt(
      'Future Work',
      [
        'Describe concrete extensions and next research steps.',
        'Connect future work to the current study limitations.',
        'Prioritize the most impactful and feasible directions.'
      ].join('\n'),
      'Use citations where relevant. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 2, recommended: 6 },
      tenseRequirements: ['future'],
      styleRequirements: ['forward-looking', 'grounded']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: false
  },
  {
    sectionKey: 'main_content',
    displayOrder: 4,
    label: 'Main Content',
    description: 'Primary narrative content for book chapters',
    instruction: buildPrompt(
      'Main Content',
      [
        'Develop the chapter argument or narrative in a structured way.',
        'Use subtopics to organize key points and evidence.',
        'Balance conceptual framing with concrete examples.'
      ].join('\n'),
      'Use citations to support claims. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 4000,
      citationRequirements: { minimum: 8, recommended: 15 },
      tenseRequirements: ['present', 'past'],
      styleRequirements: ['structured', 'evidence-based']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'case_studies',
    displayOrder: 5,
    label: 'Case Studies',
    description: 'Case studies for book chapters',
    instruction: buildPrompt(
      'Case Studies',
      [
        'Describe each case study clearly and consistently.',
        'Explain why the case is relevant to the chapter theme.',
        'Highlight key observations and outcomes.'
      ].join('\n'),
      'Use citations for sources or prior analyses. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 3, recommended: 8 },
      tenseRequirements: ['past', 'present'],
      styleRequirements: ['descriptive', 'analytical']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'case_description',
    displayOrder: 4,
    label: 'Case Description',
    description: 'Context and narrative for case study papers',
    instruction: buildPrompt(
      'Case Description',
      [
        'Describe the case context, setting, and actors.',
        'Provide necessary background details for understanding the case.',
        'Keep the narrative factual and organized.'
      ].join('\n'),
      'Use citations if describing prior work or sources. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 2, recommended: 5 },
      tenseRequirements: ['past', 'present'],
      styleRequirements: ['clear', 'structured']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'analysis',
    displayOrder: 5,
    label: 'Analysis',
    description: 'Analytical section for case study papers',
    instruction: buildPrompt(
      'Analysis',
      [
        'Analyze the case using appropriate theoretical or methodological lenses.',
        'Connect observations to the research question and literature.',
        'Highlight patterns, contradictions, and insights.'
      ].join('\n'),
      'Use citations for theoretical framing or comparisons. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 4, recommended: 10 },
      tenseRequirements: ['present'],
      styleRequirements: ['analytical', 'evidence-based']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: true
  },
  {
    sectionKey: 'recommendations',
    displayOrder: 6,
    label: 'Recommendations',
    description: 'Recommendations for case study papers',
    instruction: buildPrompt(
      'Recommendations',
      [
        'Provide actionable recommendations grounded in the analysis.',
        'Explain who should act and why the recommendation follows from findings.',
        'Prioritize high-impact, feasible actions.'
      ].join('\n'),
      'Use citations where relevant. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 1, recommended: 4 },
      tenseRequirements: ['present', 'future'],
      styleRequirements: ['actionable', 'grounded']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: false
  },
  {
    sectionKey: 'main_findings',
    displayOrder: 5,
    label: 'Main Findings',
    description: 'Brief findings for short communications',
    instruction: buildPrompt(
      'Main Findings',
      [
        'Summarize the primary result(s) in a compact form.',
        'Focus on what was discovered rather than full interpretation.',
        'Use short paragraphs or concise statements.'
      ].join('\n'),
      'Use citations only if needed to compare with prior work. Use [CITE:key] only from the provided list.'
    ),
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 0, recommended: 2 },
      tenseRequirements: ['past'],
      styleRequirements: ['concise', 'clear']
    },
    isRequired: false,
    requiresBlueprint: true,
    requiresPreviousSections: true,
    requiresCitations: false
  },
  {
    sectionKey: 'appendix',
    displayOrder: 10,
    label: 'Appendix',
    description: 'Supplementary material',
    instruction: buildPrompt(
      'Appendix',
      [
        'List supplementary materials such as instruments, detailed tables, or protocols.',
        'Use clear labels and concise descriptions.',
        'Do not introduce new arguments.'
      ].join('\n'),
      'Do not invent citations. Use [CITE:key] only if referencing a source.'
    ),
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['concise']
    },
    isRequired: false,
    requiresBlueprint: false,
    requiresPreviousSections: false,
    requiresCitations: false
  },
  {
    sectionKey: 'publications',
    displayOrder: 11,
    label: 'Publications',
    description: 'List of related publications',
    instruction: buildPrompt(
      'Publications',
      [
        'List publications related to this research project if provided.',
        'If no publication data is provided, state "No publications reported."'
      ].join('\n'),
      'Do not invent citations.'
    ),
    constraints: {
      wordLimit: 300,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['concise']
    },
    isRequired: false,
    requiresBlueprint: false,
    requiresPreviousSections: false,
    requiresCitations: false
  },
  {
    sectionKey: 'references',
    displayOrder: 99,
    label: 'References',
    description: 'Bibliography section',
    instruction: buildPrompt(
      'References',
      [
        'List references only from the provided citation keys.',
        'Do not invent or fabricate sources.',
        'If no citations are available, return "No references available."'
      ].join('\n'),
      'Use only [CITE:key] entries that appear in the citation list.'
    ),
    constraints: {
      wordLimit: 3000,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['formal']
    },
    isRequired: false,
    requiresBlueprint: false,
    requiresPreviousSections: false,
    requiresCitations: true
  }
]

// Paper-type-specific overrides
const typeOverrides: TypeOverride[] = [
  // CONFERENCE_PAPER overrides
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'abstract',
    instruction: buildPrompt(
      'Abstract',
      [
        'Write a concise abstract (150-200 words) suitable for conference proceedings.',
        'Lead with the problem and your novel contribution.',
        'Briefly mention the approach and key results.',
        'End with the significance and implications.'
      ].join('\n'),
      'Do not include citations.'
    )
  },
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'introduction',
    instruction: buildPrompt(
      'Introduction',
      [
        'Keep the introduction concise (2-4 short paragraphs).',
        'Highlight novelty and contributions early.',
        'State the research question succinctly and motivate the approach.',
        'Provide a brief structure overview in the final paragraph.'
      ].join('\n'),
      'Use citations for background and related work. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'methodology',
    instruction: buildPrompt(
      'Methodology',
      [
        'Keep the methodology concise but reproducible.',
        'Focus on experimental setup, datasets, and evaluation metrics.',
        'Clarify baselines and comparison methods.'
      ].join('\n'),
      'Cite datasets or baseline methods using [CITE:key]. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'results',
    instruction: buildPrompt(
      'Results',
      [
        'Present results concisely with focus on key metrics.',
        'Use tables and figures effectively.',
        'Compare with baselines directly.',
        'Highlight statistically significant findings.'
      ].join('\n'),
      'Use citations for baseline comparisons. Use [CITE:key] only from the provided list.'
    )
  },
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'discussion',
    instruction: buildPrompt(
      'Discussion',
      [
        'Keep the discussion concise and focused on key insights.',
        'Compare your results directly with the most relevant baselines.',
        'Acknowledge limitations briefly.',
        'Emphasize the novelty and practical implications.'
      ].join('\n'),
      'Use citations for comparisons. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'CONFERENCE_PAPER',
    sectionKey: 'conclusion',
    instruction: buildPrompt(
      'Conclusion',
      [
        'Provide a brief (1-2 paragraph) conclusion.',
        'Restate the main contribution concisely.',
        'Mention one or two key implications or future directions.',
        'End with a strong closing statement.'
      ].join('\n'),
      'Citations are optional. If used, rely on [CITE:key] only from the provided list.'
    )
  },

  // REVIEW_ARTICLE overrides
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'abstract',
    instruction: buildPrompt(
      'Abstract',
      [
        'Summarize the scope, methodology, and key findings of this review.',
        'State the number of studies reviewed and the synthesis approach.',
        'Highlight major themes, gaps, and implications for the field.',
        'Emphasize the value and timeliness of this review.'
      ].join('\n'),
      'Do not include citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'introduction',
    instruction: buildPrompt(
      'Introduction',
      [
        'Frame the scope of the review and justify its importance.',
        'Describe the review objectives and coverage boundaries.',
        'Explain the organizational structure or taxonomy used in the review.'
      ].join('\n'),
      'Use citations to justify the need for the review. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'literature_review',
    instruction: buildPrompt(
      'Literature Review',
      [
        'Provide a comprehensive synthesis of the literature.',
        'Organize the review into clear themes or taxonomies.',
        'Highlight emerging trends, unresolved debates, and research gaps.',
        'Maintain critical analysis rather than summary-only descriptions.'
      ].join('\n'),
      'Cite extensively using [CITE:key]. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'methodology',
    instruction: buildPrompt(
      'Methodology',
      [
        'Describe the review protocol, databases searched, and query strategy.',
        'Explain inclusion and exclusion criteria.',
        'Describe screening, coding, and synthesis methods.',
        'Note limitations and potential biases in the review process.'
      ].join('\n'),
      'Cite protocols or prior review methodologies using [CITE:key]. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'results',
    instruction: buildPrompt(
      'Results',
      [
        'Present the synthesized findings organized by theme or taxonomy.',
        'Summarize the number and types of studies included.',
        'Highlight key patterns, trends, and areas of consensus.',
        'Identify contradictions and gaps in the literature.',
        'Use tables or structured summaries where appropriate.'
      ].join('\n'),
      'Use citations to support each finding. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'discussion',
    instruction: buildPrompt(
      'Discussion',
      [
        'Synthesize the overall patterns and themes from the reviewed literature.',
        'Discuss conflicting findings and potential explanations.',
        'Identify the most significant gaps and their implications.',
        'Connect findings to theoretical frameworks and practical applications.',
        'Discuss limitations of the review methodology.'
      ].join('\n'),
      'Use citations to support synthesis. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'REVIEW_ARTICLE',
    sectionKey: 'conclusion',
    instruction: buildPrompt(
      'Conclusion',
      [
        'Summarize the main findings of the review.',
        'Restate the key gaps identified in the literature.',
        'Provide recommendations for future research.',
        'Discuss implications for practitioners and researchers.'
      ].join('\n'),
      'Citations are optional. If used, rely on [CITE:key] only from the provided list.'
    )
  },

  // CASE_STUDY overrides
  {
    paperTypeCode: 'CASE_STUDY',
    sectionKey: 'abstract',
    instruction: buildPrompt(
      'Abstract',
      [
        'Briefly describe the case context and its significance.',
        'State the research question or objective.',
        'Summarize the analytical approach and key findings.',
        'Highlight practical implications and lessons learned.'
      ].join('\n'),
      'Do not include citations.'
    )
  },
  {
    paperTypeCode: 'CASE_STUDY',
    sectionKey: 'methodology',
    instruction: buildPrompt(
      'Methodology',
      [
        'Explain the case selection criteria and context.',
        'Describe data sources, instruments, and analysis approach.',
        'Discuss validity considerations and limitations.'
      ].join('\n'),
      'Cite relevant methodological sources using [CITE:key]. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'CASE_STUDY',
    sectionKey: 'discussion',
    instruction: buildPrompt(
      'Discussion',
      [
        'Interpret the case findings in light of the research question.',
        'Connect observations to broader theory and literature.',
        'Discuss transferability and boundary conditions.',
        'Identify practical lessons and implications.',
        'Acknowledge limitations of the case study approach.'
      ].join('\n'),
      'Use citations for theoretical connections. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'CASE_STUDY',
    sectionKey: 'conclusion',
    instruction: buildPrompt(
      'Conclusion',
      [
        'Summarize the case findings and their significance.',
        'Restate the practical lessons learned.',
        'Discuss broader applicability and limitations.',
        'Suggest directions for future research or practice.'
      ].join('\n'),
      'Citations are optional. If used, rely on [CITE:key] only from the provided list.'
    )
  },

  // BOOK_CHAPTER overrides
  {
    paperTypeCode: 'BOOK_CHAPTER',
    sectionKey: 'abstract',
    instruction: buildPrompt(
      'Abstract',
      [
        'Summarize the chapter scope and its position within the book.',
        'State the main argument or contribution of this chapter.',
        'Preview key concepts and takeaways.',
        'Indicate the intended audience.'
      ].join('\n'),
      'Do not include citations.'
    )
  },
  {
    paperTypeCode: 'BOOK_CHAPTER',
    sectionKey: 'introduction',
    instruction: buildPrompt(
      'Introduction',
      [
        'Introduce the chapter topic and position it within the book theme.',
        'Clarify the chapter scope and intended audience.',
        'Preview the chapter structure and key takeaways.'
      ].join('\n'),
      'Use citations where needed. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },

  // SHORT_COMMUNICATION overrides
  {
    paperTypeCode: 'SHORT_COMMUNICATION',
    sectionKey: 'introduction',
    instruction: buildPrompt(
      'Introduction',
      [
        'Keep the introduction very concise and focused.',
        'State the key problem and why it matters.',
        'Lead directly into the main finding or contribution.'
      ].join('\n'),
      'Use citations sparingly where necessary. Use [CITE:key] only from the provided list. Do not invent citations.'
    )
  },
  {
    paperTypeCode: 'SHORT_COMMUNICATION',
    sectionKey: 'results',
    instruction: buildPrompt(
      'Results',
      [
        'Present the main finding(s) succinctly.',
        'Prioritize clarity and brevity.',
        'Avoid extended interpretation.'
      ].join('\n'),
      'Use citations only if essential. Use [CITE:key] only from the provided list.'
    )
  }
]

// ============================================================================
// SEEDING FUNCTIONS
// ============================================================================

async function seedSupersetSections() {
  console.log('🌱 Seeding Paper Superset Sections...')

  for (const section of supersetSections) {
    await prisma.paperSupersetSection.upsert({
      where: { sectionKey: section.sectionKey },
      update: {
        displayOrder: section.displayOrder,
        label: section.label,
        description: section.description,
        instruction: section.instruction,
        constraints: section.constraints,
        isRequired: section.isRequired,
        requiresBlueprint: section.requiresBlueprint,
        requiresPreviousSections: section.requiresPreviousSections,
        requiresCitations: section.requiresCitations,
        updatedAt: new Date()
      },
      create: {
        sectionKey: section.sectionKey,
        displayOrder: section.displayOrder,
        label: section.label,
        description: section.description,
        instruction: section.instruction,
        constraints: section.constraints,
        isRequired: section.isRequired,
        requiresBlueprint: section.requiresBlueprint,
        requiresPreviousSections: section.requiresPreviousSections,
        requiresCitations: section.requiresCitations
      }
    })
    console.log(`  ✓ ${section.sectionKey}`)
  }

  console.log(`✅ Seeded ${supersetSections.length} Paper Superset Sections`)
}

async function seedTypeOverrides() {
  console.log('🌱 Seeding Paper Type Section Prompts...')

  // First, check which paper types exist
  const existingPaperTypes = await prisma.paperTypeDefinition.findMany({
    select: { code: true }
  })
  const existingCodes = new Set(existingPaperTypes.map(pt => pt.code))

  // Track warnings for non-existent paper types
  const warnings: string[] = []
  let seededCount = 0

  for (const override of typeOverrides) {
    // Warn if paper type doesn't exist (but still create the override)
    if (!existingCodes.has(override.paperTypeCode)) {
      warnings.push(override.paperTypeCode)
    }

    try {
      await prisma.paperTypeSectionPrompt.upsert({
        where: {
          paper_type_section_unique: {
            paperTypeCode: override.paperTypeCode,
            sectionKey: override.sectionKey
          }
        },
        update: {
          instruction: override.instruction,
          constraints: override.constraints || {},
          updatedAt: new Date()
        },
        create: {
          paperTypeCode: override.paperTypeCode,
          sectionKey: override.sectionKey,
          instruction: override.instruction,
          constraints: override.constraints || {}
        }
      })
      console.log(`  ✓ ${override.paperTypeCode} → ${override.sectionKey}`)
      seededCount++
    } catch (error: any) {
      // Check if it's a foreign key constraint error (section doesn't exist)
      if (error?.code === 'P2003') {
        console.log(`  ⚠ Skipped: Section "${override.sectionKey}" not found in superset sections`)
      } else {
        throw error
      }
    }
  }

  // Show warnings for missing paper types
  const uniqueWarnings = Array.from(new Set(warnings))
  if (uniqueWarnings.length > 0) {
    console.log(`\n⚠️  Warning: The following paper types don't exist in PaperTypeDefinition:`)
    console.log(`   ${uniqueWarnings.join(', ')}`)
    console.log(`   Overrides were created but won't be active until paper types are added.\n`)
  }

  console.log(`✅ Seeded ${seededCount} Paper Type Section Prompts`)
}

async function main() {
  console.log('\n🚀 Starting Paper Section Prompt Seeding\n')

  try {
    await seedSupersetSections()
    await seedTypeOverrides()

    // Summary
    const supersetCount = await prisma.paperSupersetSection.count()
    const overrideCount = await prisma.paperTypeSectionPrompt.count()

    console.log('\n📊 Summary:')
    console.log(`   Paper Superset Sections: ${supersetCount}`)
    console.log(`   Paper Type Overrides: ${overrideCount}`)
    console.log('\n✨ Seeding complete!\n')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()

