import { BasePatentService, LLMResult, User } from './base-patent-service';
import { llmGateway } from './metering/gateway';
import { prisma } from './prisma';
import { TaskCode, NoveltySearchStatus, NoveltySearchStage } from '@prisma/client';
import { IdeaBankService } from './idea-bank-service';
import { ideaBankFunnel, type IdeaFunnelInput, type PriorArtAnalysisItem } from './idea-bank-funnel';
import crypto from 'crypto';

// LLM Prompt Specification for Novelty Search (enhanced versions)
export const NOVELTY_SEARCH_NORMALIZATION_PROMPT = `

You are a patent search strategist. Analyze the invention and return ONLY a JSON object.

INVENTION TITLE: {title}

INVENTION DESCRIPTION:

{rawIdea}

OUTPUT FORMAT â€” Return ONLY valid JSON (one object). No markdown fences, no pre/post text, no explanations.

{

  "searchQuery": "plain-English query ≤35 words describing what the invention is and how it works, suitable for patent database search",

  "invention_features": ["feature 1", "feature 2", "feature 3"],

  "inventionType": ["MECHANICAL", "SOFTWARE"]

}

GLOBAL RULES

- Output must be valid JSON (double-quoted keys/values, comma-separated).
- "inventionType": Select 1-2 best fit archetypes for the invention logic.
  - MECHANICAL: Physical structures, moving parts, tools, housing, hinges.
  - SOFTWARE: Algorithms, data processing, AI, cloud platforms, blockchain.
  - CHEMICAL: Compounds, compositions, formulations, synthesis methods.
  - ELECTRICAL: Circuits, sensors, power systems, semiconductors, signal processing.
  - BIO: Genetics, proteins, medical treatments, diagnostics, organisms.
  - GENERAL: Fallback if no specific fit.

- Return only the JSON object; nothing else.

- Use ASCII characters only.

- Do not repeat identical phrases between "searchQuery" and any item in "invention_features".

- Avoid speculative claims, performance metrics, marketing language, or legal claim phrasing.

SEARCH QUERY (field: "searchQuery")

- ≤35 words, plain English, no boolean operators, no special query syntax.

- Convey the core technical concept and the key operating mechanism(s); ignore business use cases and background context.

- Use general technical terms that maximize recall while preserving the invention's distinctive mechanism(s).

FEATURE LIST (field: "invention_features")

- Return 3â€“8 items; each 3â€“8 words.

- Each item must be a distinct technical mechanism, structure, configuration, process step, or algorithmic controlâ€”not a benefit, result, or application context.

- Phrase features broadly enough to capture synonyms and domain-equivalent terms; avoid proprietary names.

- No overlap or near-duplicates across items.

GENERIC COMPONENT HANDLING

- Do NOT list trivial, everyday components (e.g., processor, memory, sensor, transceiver, database, display, battery, network module, housing, server, API) as standalone features.

- Include such elements ONLY when they play a non-obvious role or participate in a novel configuration/interaction/control logic/material property.

- Prefer integrating generics into higher-level mechanisms (e.g., "feedback-controlled microfluidic delivery" rather than separate "controller" and "pump").

QUALITY FILTERS (apply to both fields)

- Avoid outcome/benefit-only phrases (e.g., "real-time monitoring", "smart control") unless coupled to a concrete mechanism.

- Prefer integrative/feedback mechanisms that tie sensing â†” processing â†” actuation (or domain equivalents).

- Remove filler adjectives (e.g., smart, efficient, robust) unless technically specific.

- Keep nouns/noun-phrases primary; verbs only where they define a process step or control logic.

DOMAIN ADAPTATION (choose expressions appropriate to the invention's field)

- Mechanical/Civil/Materials: express mechanisms as configurations, load/flow/thermal paths, material-geometry relationships, joining/fabrication processes, kinematics/actuation.

- Electronics/Embedded/Comms: express data paths, control logic, signal processing chains, power/latency/energy mechanisms, protocol/architecture specifics where non-obvious.

- Software/AI/Data: express model class/learning or inference mechanism, control policy, data structures/flows, algorithmic pipelines; avoid "software module" generics.

- Medical Devices/Biomed: express biosensing/transduction principles, closed-loop control, delivery/actuation mechanisms, physiological interfacing, packaging/form factor integrations.

- Biotech/Pharma/Chem: express molecular structures/classes, formulation components/ratios, binding/interaction mechanisms, reaction pathways, process steps, release profiles, scaffold/vehicle properties.

CONSTRAINTS & VALIDATION

- If the invention has fewer than 3 core mechanisms, return fewer items (do not pad with generic or redundant features).

- Do not include citations, references, or prior-art IDs.

- Do not include units, claims language ("comprising/wherein"), or legal boilerplate.

FAIL-SAFES

- If uncertain, prioritize the most distinctive mid-level mechanisms (integration, control loop, configuration, interaction) over lists of generic parts or high-level benefits.

`;

// Legacy prompts moved to bottom of file

export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT = `You are a patent analyst mapping invention features to prior-art patents.

Return ONLY one valid JSON object.

INPUTS
FEATURES: {invention_features}
PATENTS: {patent_batch} (objects with pn, title, abstract, optional claims, link)

TASK
For every patent and feature, decide:
- "Present" → mechanism clearly described in the text
- "Partial" → related but missing a key element
- "Absent" → not supported by the text

Use title/abstract/claims text only.
Match by meaning (synonyms, paraphrases) but require concrete evidence; generic words like "AI", "sensor", "module", "controller" don't qualify unless they implement the full mechanism.

When Present/Partial, quote ≤25 words from the patent as evidence (direct quote + optional short paraphrase ≤ 20 words).
If Absent, give a ≤20 word reason.

OUTPUT
Return JSON only:

{
  "feature_map": [
    {
      "pn": "string",
      "link": "string|null",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract|claims",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract|claims",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"string",
         "reason":"≤12 words"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Present = 1.0, Partial = 0.5, Absent = 0 → average → coverage_score.
- Quote required for Present/Partial; reason required for Absent.
- No invented text or assumptions; rely only on given fields.
- Keep ASCII; no markdown, comments, or explanations.`;

// V2: Compact, semantic-aware feature mapping prompt for Stage 3.5a
export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V2 = `You are a patent analyst mapping invention FEATURES to prior-art PATENTS. Return ONE JSON object only.

INPUTS
FEATURES: {invention_features}  (array of strings; copy each feature verbatim)
PATENTS: {patent_batch}  (repeated blocks with lines: PN, Title, Abstract)

TASK
For each patent PN, classify EVERY feature EXACTLY ONCE as:
- Present = mechanism clearly described with concrete wording
- Partial = related but missing a required element/constraint
- Absent = no concrete evidence in Title/Abstract

Use Title/Abstract text only.

SEMANTIC MATCHING
- Treat synonyms/paraphrases/hypernyms/hyponyms as matches if they implement the same mechanism.
- Example equivalences:
  - "AI-based image analysis" ~= "computer vision", "intelligent image processing", "image recognition", "machine vision".
  - "object detection" ~= "detecting objects", "localizing targets".
  - "classify images" ~= "image classification", "recognition via ML/CNN model".
- Present when the quote shows the mechanism in action (verb + object). Avoid generic mentions like "AI module" without the image mechanism.
- Partial when related terms appear but a required element/constraint is missing (e.g., the real-time or edge aspect).
- Absent only when no concrete evidence for the mechanism exists in Title/Abstract.

EVIDENCE AND CONFIDENCE
- Quotes must be verbatim and <= 18 words from Title/Abstract; include the decisive mechanism phrase.
- Confidence rubric: 0.9-1.0 explicit phrase match; 0.6-0.8 clear paraphrase; 0.3-0.5 weak/indirect hint.

OUTPUT (JSON only)
{
  "feature_map": [
    {
      "pn": "string",
      "link": "https://patents.google.com/patent/<pn>",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"<copy from FEATURES>",
         "reason":"no direct evidence in title/abstract"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Copy FEATURES strings exactly as given (no paraphrase); each feature appears exactly once across present/partial/absent.
- Do not add extra features; do not invent text; rely only on given fields.
- Quotes must be verbatim and <= 18 words; absent reasons <= 8 words.
- ASCII only; JSON only; no markdown, comments, or explanations.
- Output must be valid JSON (double-quoted keys/values, comma-separated).`;

// Legacy prompts moved to bottom to avoid redeclaration

export const PR_35B_NOVELTY_RATIONALE_PROMPT = `You are drafting the analytical narrative for a novelty assessment report.

INPUTS:
- Deterministic metrics (novelty_score, coverage_ratios, uniqueness_per_feature)
- Integration_check (true/false + top_pn)
- Confidence_level
- Invention_features with uniqueness %

STRUCTURE your response:
1ï¸âƒ£ Integration Analysis â€“ whether any patent integrates most features
2ï¸âƒ£ Feature Insights â€“ which features remain unique or partially known
3ï¸âƒ£ Verdict Explanation â€“ how the data supports the decision ("Novel", "Partially Novel", or "Not Novel")

TONE:
- Analytical but concise (3 short paragraphs)
- Avoid repeating numbers already shown in tables
- Use action verbs: "demonstrates", "indicates", "reveals"

Return JSON:
{"structured_narrative": {"integration": "...", "feature_insights": "...", "verdict": "..."}}`;

export const NOVELTY_REPORT_PROMPT = `You are preparing a professional, attorney-grade novelty assessment report with detailed patent-by-patent analysis.

INPUTS:
- invention_features: Array of key invention features
- selected_patents: Intersecting patents (with â‰¥1 Present/Partial feature), optionally capped to top 1â€“2 when all features are covered
- search_metadata: Search ID, date, parameters
- patent_details: Full patent information including abstracts, CPC codes, filing dates
- feature_analysis_matrix: Feature overlap percentages for each patent
- structured_narrative: Integration insights and verdict

TASK: Generate a comprehensive report with Table of Contents, hyperlinks, and detailed patent analysis.

OUTPUT JSON STRUCTURE:

{
  "table_of_contents": {
    "title": "Table Of Contents",
    "sections": [
      {"number": "01", "title": "Report", "page": "3", "link": "#report"},
      {"number": "1.1", "title": "Search Metadata Index", "page": "3", "link": "#metadata"},
      {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
      {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
      {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
      {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
      {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
    ]
  },
 "report_metadata": {
   "title": "Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
   "analyst": "SpotIPR AI",
    "total_patents_analyzed": "TOTAL_COUNT",
    "selected_patents_count": "SELECTED_COUNT"
  },
  "section_1_1_search_metadata": {
    "anchor": "metadata",
    "search_id": "SEARCH_ID",
    "search_date": "SEARCH_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "total_patents_found": "TOTAL_COUNT",
    "selection_criteria": "Intersecting references (â‰¥1 Present/Partial feature); if multiple cover all features, top 1â€“2 by PQAI relevance"
 },
  "section_1_2_key_features": {
    "anchor": "key-features",
    "title": "Key Features Generated from Search Query",
    "features_table": [
      {"number": 1, "description": "FEATURE_TEXT_1"},
      {"number": 2, "description": "FEATURE_TEXT_2"}
    ]
  },
  "section_1_3_summary": {
    "anchor": "summary",
    "title": "Summary",
    "description": "Based on the details of the invention, relevant patent citations are mapped. Further, [COUNT] other patent citations are also shortlisted. Only one patent per family is being mapped and other family members of the family are incorporated by reference. Summary of the citations is presented in the tables below. Clicking on the hyperlinks (Citation No. Column) will open the patent record in Xlpat with full text, family and legal data and the possibility to download the original document.",
    "citations_table": [
      {
        "s_no": 1,
        "citation_no": "PATENT_NUMBER",
        "title": "PATENT_TITLE",
        "publication_date": "YYYYMMDD",
        "link": "https://patents.google.com/patent/PATENT_NUMBER"
   }
    ]
 },
  "section_1_4_feature_analysis": {
    "anchor": "feature-analysis",
    "title": "Key Feature Analysis",
    "description": "The broad key features are prepared based on the details of the invention and information provided by the client. The analysis of the references has been done based on one or more features overlapping with the key features of the invention to form a relevant prior art.",
    "feature_matrix": {
      "patent_numbers": ["PATENT_1", "PATENT_2"],
      "features": [
        {"name": "KF1", "description": "FEATURE_DESC_1"},
        {"name": "KF2", "description": "FEATURE_DESC_2"}
      ],
      "overlap_data": [
        {"patent": "PATENT_1", "kf1": "85.5%", "kf2": "92.3%"},
        {"patent": "PATENT_2", "kf1": "78.9%", "kf2": "88.7%"}
      ]
    }
  },
  "section_2_1_patent_details": {
    "anchor": "patent-details",
    "title": "Details of Relevant Patent Citations",
    "patents": [
      {
        "patent_number": "PATENT_NUMBER",
        "anchor": "patent_PATENT_NUMBER",
        "basic_info": {
          "title": "PATENT_TITLE",
          "publication_number": "PUBLICATION_NUMBER",
          "filing_date": "FILING_DATE",
          "publication_date": "PUBLICATION_DATE",
          "applicant": "APPLICANT_NAME",
          "inventor": "INVENTOR_NAME",
          "cpc_codes": ["CPC1", "CPC2"],
          "abstract": "FULL_ABSTRACT_TEXT"
        },
        "feature_comparison": {
          "title": "Feature-by-Feature Analysis",
          "comparisons": [
            {
              "feature": "FEATURE_NAME",
              "patent_implementation": "How the patent implements this feature",
              "searched_idea": "How the searched idea implements this feature",
              "similarity": "High/Medium/Low",
              "novelty_impact": "Description of what makes the searched idea novel"
            }
          ]
        },
        "attorney_analysis": {
          "title": "Patent Attorney Analysis",
          "relation_to_idea": "How this patent relates to the overall searched idea",
          "existing_coverage": "What aspects are already covered by this patent",
          "novel_elements": "What novel elements exist in the proposed idea",
          "recommendations": "Strategic recommendations for claim drafting"
        }
      }
    ]
 },
  "concluding_remarks": {
    "title": "Final Concluding Remarks",
    "overall_novelty_assessment": "High/Medium/Low novelty assessment",
    "key_strengths": ["Strength 1", "Strength 2"],
    "key_risks": ["Risk 1", "Risk 2"],
    "strategic_recommendations": ["Recommendation 1", "Recommendation 2"],
    "filing_advice": "Specific advice for patent filing strategy"
  }
}

GUIDELINES:
- Generate detailed attorney-style analysis for each selected patent
- Include feature-by-feature comparisons with technical depth
- Provide strategic insights for patent prosecution
- Ensure all hyperlinks work for navigation
- Format tables cleanly with proper alignment
- Use professional legal terminology appropriate for patent analysis`


// V2: Compact Stage 4 prompt aligned to the Stage 4 UI.
// Focuses on a small, JSON-only output without perâ€‘patent tables to reduce tokens.
/* LEGACY: do not use, replaced by STAGE4_REPORT_PROMPT_V3 */
// Lightweight prompt: compile final report strictly from per-patent remarks
/* LEGACY: do not use, replaced by STAGE4_REPORT_PROMPT_FROM_REMARKS_V2 */
// New Stage 4 prompts (attorney-style, JSON-only)
export const STAGE4_REPORT_PROMPT_V3 = `You are a senior patent attorney preparing the FINAL CONCLUDING REMARKS for the Novelty UI.

IMPORTANT: Detailed per-patent analysis is already provided in Stage 3.5c. Your role is to provide FINAL STRATEGIC CONCLUSIONS.

Use the following inputs only for reasoning — do not echo them back verbatim:
- invention_features: {invention_features}
- selected_patents: {selected_patents} (includes per_patent_remarks with detailed analysis from Stage 3.5c)
- search_metadata: {search_metadata}
- feature_analysis_matrix: {feature_analysis_matrix}
- structured_narrative: {structured_narrative}

Objectives:
- Provide HONEST, STRAIGHTFORWARD final assessment based on the closest matching patents.
- Give actionable recommendations on how to make the invention MORE NOVEL.
- Suggest course corrections or improvements if novelty is threatened.
- Be candid about risks - if a patent anticipates the invention, say so clearly.

Hard constraints:
- Return valid JSON only (no markdown, no prose before/after).
- Do NOT include per_patent_analysis (that's in Stage 3.5c now).
- Keep the executive summary under 250 words; each bullet under 18 words.
- Focus on STRATEGIC GUIDANCE, not detailed patent comparisons.

Output JSON shape (exact keys):
{
  "report_metadata": {
    "title": "Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "analyst": "PatentNest.ai — Stage 4"
  },
  "search_trail": {
    "pqai_initial_count": "number | null",
    "ai_relevance_accepted": "number | null",
    "ai_relevance_borderline": "number | null",
    "deeply_analyzed_count": "number | null"
  },
  "executive_summary": {
    "summary": "HONEST assessment: What is the novelty outlook? What are the closest threats? What makes the invention unique despite prior art?",
    "visual_cards": {
      "Novelty Score": "..%",
      "Patents Analyzed": "N",
      "Unique Features": "X of Y",
      "Confidence": "High|Medium|Low"
    }
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "Novel | Partially Novel | Not Novel | Low Evidence",
    "honest_assessment": "A candid 2-3 sentence verdict on the invention's novelty prospects",
    "key_strengths": ["What makes this invention defensible", "Unique technical contributions", "..."],
    "key_risks": ["Specific threats from prior art", "What could invalidate claims", "..."],
    "strategic_recommendations": ["How to strengthen novelty", "Claim drafting focus areas", "Technical improvements to consider"],
    "course_corrections": ["If novelty is weak, what changes would help", "Alternative approaches to consider"],
    "filing_advice": "Action-oriented guidance: proceed, pivot, or strengthen specific aspects",
    "inventor_action_items": ["Specific next steps for the inventor", "Research/development suggestions"]
  },
  "idea_bank_suggestions": [
    {
      "title": "Improvement idea title",
      "core_principle": "Technical enhancement that increases novelty",
      "expected_advantage": "How this addresses prior art gaps",
      "tags": ["mechanism", "domain"],
      "non_obvious_extension": "Concrete step reducing obviousness risk"
    }
  ]
}

Authoring guidance:
- Be HONEST: If the closest patents seriously threaten novelty, say so and explain why.
- Be CONSTRUCTIVE: Always provide actionable suggestions for improvement.
- Focus on the TOP 2-3 closest matching patents when drawing conclusions.
- course_corrections should offer real alternatives if current approach has issues.
- inventor_action_items should be specific and actionable (not generic advice).
- idea_bank_suggestions should help pivot or strengthen the invention.
`;

export const STAGE4_REPORT_PROMPT_FROM_REMARKS_V2 = `You are a senior patent attorney preparing the FINAL CONCLUDING REMARKS from per-patent analysis.

IMPORTANT: Detailed per-patent analysis is already provided in Stage 3.5c. Your role is to provide FINAL STRATEGIC CONCLUSIONS.

Inputs provided separately in this prompt:
- per_patent_remarks: JSON array with detailed analysis (pn, title, remarks, relevance, novelty_threat, detailedAnalysis, etc.)
- invention_features: optional JSON array of strings (mechanism-level)
- search_metadata: optional JSON with counts

Your job: Synthesize the per_patent_remarks into HONEST, ACTIONABLE conclusions.

Strict rules:
- Focus on the TOP 2-3 closest matching patents when drawing conclusions.
- Be CANDID about risks - if a patent anticipates the invention, say so clearly.
- Provide ACTIONABLE recommendations for improvement.
- Return valid JSON only, no markdown.

Output JSON shape (exact keys):
{
  "report_metadata": {
    "title": "Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "analyst": "PatentNest.ai — Stage 4"
  },
  "search_trail": {
    "pqai_initial_count": "number | null",
    "ai_relevance_accepted": "number | null",
    "ai_relevance_borderline": "number | null",
    "deeply_analyzed_count": "number | null"
  },
  "executive_summary": {
    "summary": "HONEST assessment based on closest matching patents. What threatens novelty? What remains unique?",
    "visual_cards": {
      "Novelty Score": "..%",
      "Patents Analyzed": "N",
      "Unique Features": "X of Y",
      "Confidence": "High|Medium|Low"
    }
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "Novel | Partially Novel | Not Novel | Low Evidence",
    "honest_assessment": "Candid 2-3 sentence verdict on novelty prospects based on the closest threats",
    "key_strengths": ["What makes this invention defensible", "Unique contributions"],
    "key_risks": ["Specific prior art threats", "What could invalidate claims"],
    "strategic_recommendations": ["How to strengthen novelty", "Claim drafting focus areas"],
    "course_corrections": ["If novelty is weak, what changes would help", "Alternative approaches"],
    "filing_advice": "Action-oriented: proceed, pivot, or strengthen specific aspects",
    "inventor_action_items": ["Specific next steps", "Research/development suggestions"]
  },
  "idea_bank_suggestions": [
    {
      "title": "Improvement idea",
      "core_principle": "Technical enhancement increasing novelty",
      "expected_advantage": "How this addresses prior art gaps",
      "tags": ["mechanism", "domain"],
      "non_obvious_extension": "Concrete step reducing obviousness risk"
    }
  ]
}

Authoring guidance:
- Identify the TOP THREATS from per_patent_remarks (highest relevance, 'anticipates' or 'obvious' novelty_threat).
- honest_assessment should directly address these threats and the invention's prospects.
- course_corrections should offer REAL alternatives if current approach has serious issues.
- inventor_action_items should be specific and immediately actionable.
- idea_bank_suggestions should help pivot or strengthen against identified weakness
`;

export interface NoveltySearchConfig {
  jurisdiction: string;
  filingType: string;
  tenantId?: string;
  // Stage 1.5 - AI Relevance gate on PQAI results
  stage15: {
    modelPreference: 'gemini-2.5-flash-lite' | 'gemini-2.5-pro' | 'gemini-2.0-flash-lite' | 'gpt-4o-mini' | 'gpt-4o' | 'claude-2.5';
    thresholds: { high: number; medium: number };
    borderlineQuota: number; // number of borderline items to keep for diversity/recall
    maxCandidates: number;   // upper bound of PQAI items to gate
    batchSize: number;       // batch size for LLM calls
  };
  stage0: {
    customPrompt?: string;
    extractionRules?: Record<string, any>;
  };
  stage1: {
    maxPatents: number;
    relevanceThresholds: { high: number; medium: number };
    customPrompt?: string;
  };
  stage35a: {
    batchSize: number;
    maxRefsTotal: number;
    thresholdPresent: number;
    thresholdPartial: number;
    criticalFeatures: string[];
    modelPreference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-flash-lite' | 'gemini-2.5-pro';
    // When Stage 1.5 accepts more than the 50% quota, allow extra mapping capacity
    acceptedOverflowRatio?: number;   // default 0.15 (15% of total PQAI)
    borderlineOverflowRatio?: number; // default 0.10 (10% of total PQAI)
    customPrompt?: string;
  };
  stage35b: {
    // Deterministic - no config needed
  };
  stage35c?: {
    modelPreference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-flash-lite' | 'gemini-2.5-pro';
    maxPatentsForRemarks?: number; // Optional cap; default: all in feature_map
    batchSize?: number; // Number of patents per LLM call
  };
  stage4: {
    reportFormat: 'PDF' | 'JSON' | 'HTML';
    includeExecutiveSummary: boolean;
    includeTechnicalDetails: boolean;
    colorCoding: boolean;
    maxRefsForReportMain: number;
    maxRefsForUI: number;
    modelPreference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-flash-lite' | 'gemini-2.5-pro';
  };
}

export interface NoveltySearchRequest {
  patentId?: string; // Optional - can create standalone search
  projectId?: string; // Optional - can associate with a project
  jwtToken: string;
  inventionDescription: string;
  title: string;
  jurisdiction?: string;
  config?: Partial<NoveltySearchConfig>;
}

export interface NoveltySearchResponse {
  success: boolean;
  searchId?: string;
  status?: NoveltySearchStatus;
  currentStage?: NoveltySearchStage;
  results?: any;
  error?: string;
}

export interface NormalizedIdea {
  searchQuery: string;
  inventionFeatures?: string[];
  inventionType?: string[];
}

export interface ScreeningResult {
  overall_determination: 'NOVEL' | 'NOT_NOVEL' | 'DOUBT';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning_summary: string;
  patent_assessments: Array<{
    publication_number: string;
    relevance: 'HIGH' | 'MEDIUM' | 'LOW';
    reasoning: string;
    key_differences: string;
    novelty_threat: string;
  }>;
  recommended_next_steps: string;
  search_expansion_needed: boolean;
}

export interface AssessmentResult {
  determination: 'NOVEL' | 'NOT_NOVEL' | 'PARTIALLY_NOVEL';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  novelty_analysis: {
    anticipated_elements: string[];
    novel_elements: string[];
    key_differences: string[];
  };
  non_obviousness_analysis: {
    obviousness_risks: string[];
    inventive_aspects: string[];
    prior_art_combinations: string[];
  };
  scope_analysis: {
    claim_breadth: 'NARROW' | 'MEDIUM' | 'BROAD';
    infringement_risk: 'LOW' | 'MEDIUM' | 'HIGH';
    workaround_options: string[];
  };
  commercial_analysis: {
    freedom_to_operate: 'CLEAR' | 'RISKY' | 'BLOCKED';
    licensing_opportunities: string[];
    market_impact: string;
  };
  recommendations: {
    prosecution_strategy: string[];
    freedom_to_operate: string[];
    next_steps: string[];
  };
  executive_summary: string;
}

// New interfaces for Stage 3.5a and 3.5b
export interface FeatureMapCell {
  feature: string;
  status: 'Present' | 'Partial' | 'Absent' | 'Unknown';
  confidence?: number;
  quote?: string;
  field?: string;
  reason?: string;
  evidence?: string | {
    quote: string;
    field: string;
  };
}

export interface PatentCoverage {
  present: number;
  partial: number;
  absent: number;
  coverage_score?: number; // Computed on our side
}

export interface PatentFeatureMap {
  pn: string;
  title?: string;
  link?: string | null;
  coverage?: PatentCoverage;
  present?: FeatureMapCell[];
  partial?: FeatureMapCell[];
  absent?: FeatureMapCell[];
  feature_analysis: FeatureMapCell[]; // For backward compatibility - always present after validation
  // New: lightweight narrative + labels (produced in 3.5a)
  remarks?: string; // 2â€“4 sentences, no legalese
  model_decision?: 'novel' | 'partial_novelty' | 'obvious';
  decision?: 'novel' | 'partial_novelty' | 'obvious'; // deterministic server computation
}

export interface FeatureMapBatchResult {
  feature_map: PatentFeatureMap[];
  quality_flags: {
    low_evidence: boolean;
    ambiguous_abstracts: boolean;
    language_mismatch: boolean;
  };
  stats: {
    patents_analyzed: number;
    avg_abstract_length_words: number;
  };
}

export interface PerPatentCoverage {
  pn: string;
  present_count: number;
  partial_count: number;
  absent_count: number;
  coverage_ratio: number;
}

export interface PerFeatureUniqueness {
  feature: string;
  present_in: number;
  partial_in: number;
  absent_in: number;
  uniqueness: number;
}

export interface IntegrationCheck {
  any_single_patent_covers_majority: boolean;
  integration_pn?: string;
  explanation: string;
}

export interface FeatureMatrixCell {
  patentNumber: string;
  feature: string;
  status: 'Present' | 'Partial' | 'Absent';
  confidence?: number;
  evidence?: string;
  reason?: string;
}

export interface FeatureMatrix {
  patents: string[];
  features: string[];
  cells: FeatureMatrixCell[];
  patentTitles: Record<string, string>;
  llmUsage: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
}

export interface AggregationResult {
  idea_id: string;
  per_patent_coverage: PerPatentCoverage[];
  per_feature_uniqueness: PerFeatureUniqueness[];
  integration_check: IntegrationCheck;
  novelty_score: number;
  decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';
  confidence: 'High' | 'Medium' | 'Low';
  risk_factors: string[];
  feature_matrix?: FeatureMatrix;
  structured_narrative?: any;
  // Optional per-patent remarks derived from Stage 3.5a mappings
  per_patent_remarks?: PerPatentRemark[];
}

// Stage 3.5c / 3.5a per-patent remarks structure
export interface PerPatentRemark {
  pn: string;
  title?: string;
  abstract?: string;
  remarks: string; // concise, short narrative (< 25 words preferred)
  overlap_features?: string[];
  missing_features?: string[];
  novelty_points?: string[];
  confidence?: number; // 0..1
  decision?: 'novel' | 'partial_novelty' | 'obvious';
  // Enhanced detailed analysis fields (for Stage 3.5c)
  relevance?: number; // 0-1 relevance/overlap score
  novelty_threat?: 'anticipates' | 'obvious' | 'adjacent' | 'remote';
  summary?: string; // analysis summary
  detailedAnalysis?: {
    relevant_parts: string[];    // overlapping elements with prior art
    irrelevant_parts: string[];  // differentiators - what's unique to the invention
    novelty_comparison: string;  // detailed novelty assessment narrative
  };
}

export class NoveltySearchService extends BasePatentService {

  private defaultConfig: NoveltySearchConfig = {
    jurisdiction: 'IN',
    filingType: 'utility',
    // New Stage 1.5 (AI Relevance) defaults
    stage15: {
      modelPreference: 'gemini-2.5-flash-lite',
      thresholds: { high: 0.6, medium: 0.4 },
      borderlineQuota: 5,
      maxCandidates: 40,  // Reduced from 80 to 40 to prevent timeouts
      batchSize: 12        // Increased from 8 to 12 to reduce number of LLM calls
    },
    stage0: {},
    stage1: {
      maxPatents: 60, // Increased for more comprehensive analysis
      relevanceThresholds: { high: 0.8, medium: 0.5 }
    },
    stage35a: {
      batchSize: 8,
      maxRefsTotal: 60,
      thresholdPresent: 0.70,
      thresholdPartial: 0.40,
      criticalFeatures: [],
      modelPreference: 'gemini-2.5-flash-lite',
      acceptedOverflowRatio: 0.15,
      borderlineOverflowRatio: 0.10
    },
    stage35b: {},
    stage35c: {
      modelPreference: 'gemini-2.5-flash-lite',
      maxPatentsForRemarks: undefined,
      batchSize: 8
    },
    stage4: {
      reportFormat: 'PDF',
      includeExecutiveSummary: true,
      includeTechnicalDetails: true,
      colorCoding: true,
      maxRefsForReportMain: 10,
      maxRefsForUI: 12,
      // Default LLM for final Stage 4 analysis
      modelPreference: 'gemini-2.5-pro'
    }
  };

  /**
   * Start a complete novelty search workflow
   */
  async startNoveltySearch(request: NoveltySearchRequest): Promise<NoveltySearchResponse> {
    try {
      // Validate user
      const user = await this.validateUser(request.jwtToken);

      // Merge config with defaults
      const config = { ...this.defaultConfig, ...request.config };

      // Validate patent access if provided
      if (request.patentId) {
        await this.validatePatentAccess(request.patentId, user.id);
      }

      // Validate project access if provided
      if (request.projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: request.projectId,
            userId: user.id
          }
        });
        if (!project) {
          throw new Error('Project not found or access denied');
        }
      }

      // Create search run record
      const searchRun = await prisma.noveltySearchRun.create({
        data: {
          patentId: request.patentId,
          projectId: request.projectId,
          userId: user.id,
          status: NoveltySearchStatus.PENDING,
          currentStage: NoveltySearchStage.STAGE_0,
          config: config,
          inventionDescription: request.inventionDescription,
          title: request.title,
          jurisdiction: config.jurisdiction,
          filingType: config.filingType,
        },
      });

      // Start Stage 0: Idea Normalization
      const stage0Result = await this.performStage0(searchRun.id, request, config, user, request.jwtToken ? { authorization: `Bearer ${request.jwtToken}` } : {});

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchRun.id },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchRun.id },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId: searchRun.id,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Novelty search start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start novelty search'
      };
    }
  }

  /**
   * Execute Stage 1.5: AI Relevance Gate
   */
  async executeStage15(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage1Data = searchRun.stage1Results as unknown as any;
      if (!stage1Data || !Array.isArray(stage1Data?.pqaiResults) || stage1Data.pqaiResults.length === 0) {
        return { success: false, error: 'Stage 1 results are required before Stage 1.5' };
      }

      const gate = await this.performStage15(searchId, stage0Data, stage1Data, config, requestHeaders);
      if (!gate.success) return { success: false, error: gate.error || 'Stage 1.5 failed' };

      // Merge back into stage1Results and persist
      const merged = { ...(stage1Data || {}), aiRelevance: gate.data };
      await prisma.noveltySearchRun.update({ where: { id: searchId }, data: { stage1Results: merged as any } });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_1_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1, // logical marker; pipeline may still jump to 3.5 next
        results: merged
      };
    } catch (error) {
      console.error('Stage 1.5 execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 1.5 execution failed' };
    }
  }

  /**
   * Execute Stage 1: Initial Screening
   */
  async executeStage1(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_1) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;

      // Perform Stage 1 screening using PQAI only; return raw results for UI display
      const stage1Result = await this.performStage1(searchId, stage0Data, config);

      if (!stage1Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage1Result.error };
      }

      // Determine next stage based on results
      const screeningData = stage1Result.data as any;
      const hasResults = Array.isArray(screeningData?.pqaiResults) && screeningData.pqaiResults.length > 0;
      const nextStage: NoveltySearchStage = hasResults ? NoveltySearchStage.STAGE_3_5 : NoveltySearchStage.STAGE_4;
      const status: NoveltySearchStatus = NoveltySearchStatus.STAGE_1_COMPLETED;

        const mergedStage1 = { ...(screeningData || {}), stage0: stage0Data };

        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: {
            currentStage: nextStage,
            status: status,
            stage1CompletedAt: new Date(),
            stage1Results: mergedStage1 as any
          }
        });

        return {
          success: true,
          searchId,
          status,
          currentStage: nextStage,
          results: mergedStage1
        };

    } catch (error) {
      console.error('Stage 1 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 1 execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5a: Feature Mapping Engine
   */
  async executeStage35a(
    searchId: string,
    userId: string,
    requestHeaders?: Record<string, string>,
    selectedPublicationNumbers?: string[]
  ): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      let stage1Data = searchRun.stage1Results as unknown as any;

      console.log('[Stage3.5a][Service] selectedPublicationNumbers:', Array.isArray(selectedPublicationNumbers) ? selectedPublicationNumbers.length : 'n/a');
      console.log('[Stage3.5a][Service] stage1Results keys:', stage1Data ? Object.keys(stage1Data) : 'no stage1Results');
      console.log('[Stage3.5a][Service] stage1 pqai count:', Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults.length : 'n/a');

      // Check if Stage 1 results are available - manual progression requires explicit stage execution
      if (!stage1Data || !Array.isArray(stage1Data.pqaiResults) || stage1Data.pqaiResults.length === 0) {
        console.warn('[Stage3.5a][Service] Missing or empty Stage 1 results. Stage 3.5a requires Stage 1 to be completed first.');
        return {
          success: false,
          error: 'Stage 1 must be completed before running Stage 3.5a. Please execute Stage 1 first to fetch patent search results.'
        };
      }

      // If client provided a list of selected publication numbers, filter Stage 1 PQAI results to those
      if (Array.isArray(selectedPublicationNumbers) && selectedPublicationNumbers.length > 0 && Array.isArray(stage1Data?.pqaiResults)) {
        const pnSet = new Set(selectedPublicationNumbers);
        const before = stage1Data.pqaiResults.length;
        stage1Data.pqaiResults = stage1Data.pqaiResults.filter((p: any) => {
          const pn = p.publicationNumber || p.pn || p.patent_number || p.publication_number || p.id;
          return pn && pnSet.has(pn);
        });
        console.log('[Stage3.5a][Service] Filtered PQAI results by selection:', { before, after: stage1Data.pqaiResults.length });
      }

      // If AI relevance (Stage 1.5) has not been computed yet, do it now
      if (!stage1Data.aiRelevance && Array.isArray(stage1Data?.pqaiResults) && stage1Data.pqaiResults.length > 0) {
        try {
          const stage15 = await this.performStage15(
            searchId,
            stage0Data,
            stage1Data,
            searchRun.config as unknown as NoveltySearchConfig,
            requestHeaders
          );
          if (stage15.success && stage15.data) {
            stage1Data.aiRelevance = stage15.data;
            await prisma.noveltySearchRun.update({
              where: { id: searchId },
              data: {
                stage1Results: stage1Data as any
              }
            });
          }
        } catch (e) {
          console.warn('[Stage3.5a][Service] Stage 1.5 gate failed, proceeding without it:', e);
        }
      }

      // Perform Stage 3.5a feature mapping
      const stage35aResult = await this.performStage35a(
        searchId,
        stage0Data,
        stage1Data,
        config,
        requestHeaders
      );

      if (!stage35aResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35aResult.error };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed to STAGE_3_5A in enum
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed to STAGE_3_5A_COMPLETED
          stage35CompletedAt: new Date(),
          stage35Results: stage35aResult.data as any,
          stage4Results: undefined // Will be filled by stage 3.5b
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed
        currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed
        results: stage35aResult.data
      };

    } catch (error) {
      console.error('Stage 3.5a execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5b: Aggregation & Risk Analysis
   */
  async executeStage35b(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage35aData = searchRun.stage35Results as unknown as FeatureMapBatchResult;

      // Perform Stage 3.5b aggregation
      const stage35bResult = await this.performStage35b(searchId, stage0Data, stage35aData, config, requestHeaders);

      if (!stage35bResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35bResult.error };
      }

      // Persist aggregation snapshot into stage4Results, but do NOT mark overall search as COMPLETED here.
      // Leave status at STAGE_3_5_COMPLETED and advance currentStage pointer to STAGE_4 for next action.
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_4,
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
          stage4Results: stage35bResult.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_4,
        results: stage35bResult.data
      };

    } catch (error) {
      console.error('Stage 3.5b execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5c: Patent-by-Patent Remarks (Lite model)
   * - Generates concise remarks per patent using stage35a feature_map and PQAI abstracts
   * - Persists results under stage4Results.per_patent_remarks (without completing Stage 4)
   */
  async executeStage35c(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      const searchRun = await prisma.noveltySearchRun.findFirst({ where: { id: searchId, userId } });
      if (!searchRun) return { success: false, error: 'Novelty search not found' };

      const config = (searchRun.config as unknown as NoveltySearchConfig) || this.defaultConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage1Data = searchRun.stage1Results as unknown as any;
      const stage35aData = searchRun.stage35Results as unknown as FeatureMapBatchResult;

      if (!stage0Data?.inventionFeatures || !Array.isArray(stage0Data.inventionFeatures)) {
        return { success: false, error: 'Stage 0 features are required for Stage 3.5c' };
      }
      if (!stage35aData || !Array.isArray(stage35aData.feature_map) || stage35aData.feature_map.length === 0) {
        return { success: false, error: 'Stage 3.5a results are required for Stage 3.5c' };
      }

      // Ensure aggregation snapshot exists in stage4Results for continuity
      let aggregationResult = searchRun.stage4Results as unknown as AggregationResult | null;
      if (!aggregationResult) {
        const agg = await this.performStage35b(searchId, stage0Data, stage35aData, config, requestHeaders);
        if (!agg.success || !agg.data) {
          return { success: false, error: agg.error || 'Failed to compute aggregation for Stage 3.5c' };
        }
        aggregationResult = agg.data;
      }

      // Build quick lookup for abstracts from Stage 1 PQAI results
      const abstractByPn = new Map<string, string>();
      const titleByPn = new Map<string, string>();
      const pqai = Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : [];
      for (const r of pqai) {
        const pn = String(r.publication_number || r.publicationNumber || r.pn || r.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!pn) continue;
        const title = String(r.title || r.publication_title || '').trim();
        let abstractRaw: any = (r.abstract || r.snippet || r.description || r.abstract_text || r.abstractText || r.abstract_en || r.abstractEnglish || '');
        if (Array.isArray(abstractRaw)) abstractRaw = abstractRaw.join(' ');
        const abstract = String(abstractRaw || '').trim();
        if (!abstractByPn.has(pn)) {
          abstractByPn.set(pn, abstract);
          if (title) titleByPn.set(pn, title);
        }
      }

      const featureMaps = stage35aData.feature_map;
      const features = stage0Data.inventionFeatures;
      const limit = config.stage35c?.maxPatentsForRemarks && config.stage35c.maxPatentsForRemarks > 0 ? config.stage35c.maxPatentsForRemarks : featureMaps.length;

      const perPatentRemarks: PerPatentRemark[] = [];

      // Batch mode: try to generate remarks in groups to reduce LLM calls
      try {
        const batchSize = Math.max(1, config.stage35c?.batchSize || 8);
        const capped = featureMaps.slice(0, Math.min(limit, featureMaps.length));
        const batches = this.createBatches(capped, batchSize);
        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi];
          const itemsText = batch.map((p, idx) => {
            const pnB = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const titleB = p.title || titleByPn.get(pnB) || 'Untitled';
            const abstractB = abstractByPn.get(pnB) || p.link || '';
            const presentB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
            const partialB = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
            const absentB = features.filter(f => !presentB.includes(f) && !partialB.includes(f));
            const maxAbs = abstractB ? String(abstractB).split(/\s+/).slice(0, 120).join(' ') : '';
            return [
              `Item ${idx + 1}:`,
              `PN: ${pnB}`,
              `Title: ${titleB}`,
              `Abstract: ${maxAbs || 'N/A'}`,
              `Features: ${JSON.stringify(features)}`,
              `Present: ${JSON.stringify(presentB)}`,
              `Partial: ${JSON.stringify(partialB)}`,
              `Absent: ${JSON.stringify(absentB)}`,
              '---'
            ].join('\n');
          }).join('\n');

          const batchPrompt = [
            'You are a senior patent analyst providing detailed prior art assessment for inventor review.',
            'Given invention features and multiple prior-art patents with their feature mapping, return ONLY a JSON array.',
            '',
            'Each element must have these fields:',
            '{',
            '  "pn": "patent number",',
            '  "title": "patent title",',
            '  "relevance": 0.0-1.0 (how relevant/threatening is this patent to the invention),',
            '  "novelty_threat": "anticipates|obvious|adjacent|remote",',
            '  "summary": "2-3 sentence analysis summary",',
            '  "detailedAnalysis": {',
            '    "relevant_parts": ["specific overlapping elements - what the patent covers that matches the invention"],',
            '    "irrelevant_parts": ["differentiators - what makes the invention UNIQUE vs this patent"],',
            '    "novelty_comparison": "detailed novelty assessment: how does the invention differ technically? what improvements does it offer?"',
            '  },',
            '  "overlap_features": ["features present in both"],',
            '  "missing_features": ["features absent from patent"],',
            '  "novelty_points": ["short phrases of unique aspects"],',
            '  "confidence": 0.0-1.0',
            '}',
            '',
            'NOVELTY THREAT LEVELS:',
            '- anticipates: Patent covers most/all features, high risk to novelty',
            '- obvious: Patent + common knowledge could combine to reach invention',
            '- adjacent: Related field but different approach/mechanism',
            '- remote: Minimal overlap, low threat to novelty',
            '',
            'Be HONEST and STRAIGHTFORWARD. If a patent is highly relevant, say so clearly.',
            'Focus on actionable insights the inventor can use to strengthen their claims.',
            'JSON only; follow input PN order.',
            '',
            itemsText
          ].join('\n');

          const llmBatch = await llmGateway.executeLLMOperation(
            { headers: requestHeaders || {} },
            { taskCode: TaskCode.LLM5_NOVELTY_ASSESS, stageCode: 'NOVELTY_COMPARISON', prompt: batchPrompt }
          );

          let parsedArr: any[] | null = null;
          if (llmBatch.success && llmBatch.response?.output) {
            try { const pr = this.parseLLMResponse(llmBatch.response.output); if (Array.isArray(pr)) parsedArr = pr; } catch {}
            if (!parsedArr) {
              try {
                const raw = String(llmBatch.response.output).trim();
                const codeMatch = raw.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/i);
                const content = codeMatch ? codeMatch[1] : (raw.startsWith('[') ? raw : '');
                if (content) {
                  const tmp = JSON.parse(content);
                  if (Array.isArray(tmp)) parsedArr = tmp;
                }
              } catch {}
            }
          }

          for (let i = 0; i < batch.length; i++) {
            const p = batch[i];
            const pn = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const title = p.title || titleByPn.get(pn);
            const abstract = abstractByPn.get(pn) || p.link || '';
            const present = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
            const partial = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
            const absent = features.filter(f => !present.includes(f) && !partial.includes(f));
            const maxAbstract = abstract ? String(abstract).split(/\s+/).slice(0, 120).join(' ') : '';

            let item: PerPatentRemark | null = null;
            const fromParsed = Array.isArray(parsedArr) ? parsedArr[i] : undefined;
            if (fromParsed && (fromParsed.pn || fromParsed.remarks || fromParsed.summary)) {
              try {
                item = {
                  pn,
                  title: fromParsed.title || title || undefined,
                  abstract: maxAbstract || undefined,
                  remarks: fromParsed.remarks || fromParsed.summary || '',
                  overlap_features: Array.isArray(fromParsed.overlap_features) ? fromParsed.overlap_features : present,
                  missing_features: Array.isArray(fromParsed.missing_features) ? fromParsed.missing_features : absent,
                  novelty_points: Array.isArray(fromParsed.novelty_points) ? fromParsed.novelty_points : [],
                  confidence: typeof fromParsed.confidence === 'number' ? fromParsed.confidence : undefined,
                  // Enhanced detailed analysis fields
                  relevance: typeof fromParsed.relevance === 'number' ? fromParsed.relevance : undefined,
                  novelty_threat: ['anticipates', 'obvious', 'adjacent', 'remote'].includes(fromParsed.novelty_threat) 
                    ? fromParsed.novelty_threat : undefined,
                  summary: fromParsed.summary || fromParsed.remarks || undefined,
                  detailedAnalysis: fromParsed.detailedAnalysis ? {
                    relevant_parts: Array.isArray(fromParsed.detailedAnalysis.relevant_parts) 
                      ? fromParsed.detailedAnalysis.relevant_parts : [],
                    irrelevant_parts: Array.isArray(fromParsed.detailedAnalysis.irrelevant_parts) 
                      ? fromParsed.detailedAnalysis.irrelevant_parts : [],
                    novelty_comparison: fromParsed.detailedAnalysis.novelty_comparison || ''
                  } : undefined
                };
              } catch {}
            }
            if (!item) {
              const lines: string[] = [];
              if (present.length) lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '...' : ''}.`);
              if (absent.length) lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '...' : ''}.`);
              if (partial.length) lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '...' : ''}.`);
              if (lines.length === 0) lines.push('Insufficient evidence in title/abstract to assess overlap.');
              // Compute relevance score for fallback
              const total = Math.max(1, features.length);
              const relevanceScore = (present.length + partial.length * 0.5) / total;
              const threatLevel = relevanceScore >= 0.7 ? 'anticipates' : relevanceScore >= 0.5 ? 'obvious' : relevanceScore >= 0.3 ? 'adjacent' : 'remote';
              item = { 
                pn, 
                title, 
                abstract: maxAbstract || undefined, 
                remarks: lines.join(' '), 
                overlap_features: present, 
                missing_features: absent, 
                novelty_points: absent.slice(0, 3), // Use absent features as novelty points
                confidence: undefined,
                relevance: relevanceScore,
                novelty_threat: threatLevel as 'anticipates' | 'obvious' | 'adjacent' | 'remote',
                summary: lines.join(' '),
                detailedAnalysis: {
                  relevant_parts: present.map((f: string) => `Patent covers: ${f}`),
                  irrelevant_parts: absent.map((f: string) => `Invention unique: ${f}`),
                  novelty_comparison: `This patent ${present.length > 0 ? `overlaps on ${present.length} feature(s)` : 'has minimal overlap'} with the invention. ${absent.length > 0 ? `The invention remains differentiated by ${absent.length} unique feature(s).` : ''}`
                }
              };
            }
            // Compute per-patent decision
            {
              const total = Math.max(1, features.length);
              const presentCount = present.length;
              const partialCount = partial.length;
              const coverage = presentCount / total;
              const critical = (config.stage35a?.criticalFeatures || []);
              const allCriticalPresent = critical.length > 0 ? critical.every(cf => present.includes(cf)) : false;
              const decision: 'obvious' | 'partial_novelty' | 'novel' = (allCriticalPresent && coverage >= 0.6)
                ? 'obvious'
                : ((presentCount + partialCount) / total >= 0.4 ? 'partial_novelty' : 'novel');
              (item as any).decision = decision;
            }
            perPatentRemarks.push(item);
          }
        }
      } catch (batchError) {
        console.warn('[Stage3.5c] Batch mode failed, falling back to perâ€‘patent calls:', batchError);
      }

      // If batch produced results for all, skip single-call fallback
      if (perPatentRemarks.length < Math.min(limit, featureMaps.length)) {
        for (let i = perPatentRemarks.length; i < Math.min(limit, featureMaps.length); i++) {
          const p = featureMaps[i];
          const pn = String(p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const title = p.title || titleByPn.get(pn);
          const abstract = abstractByPn.get(pn) || p.link || '';

        // Summarize local present/absent lists deterministically
        const present = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
        const partial = (p.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
        const absent = features.filter(f => !present.includes(f) && !partial.includes(f));

        // Build detailed prompt for single patent analysis
        const maxAbstract = abstract ? String(abstract).split(/\s+/).slice(0, 120).join(' ') : '';
        const prompt = [
          'You are a senior patent analyst providing detailed prior art assessment for inventor review.',
          'Given invention features and a single prior-art patent with feature mapping, output ONLY JSON.',
          '',
          'Output structure:',
          '{',
          '  "pn": "patent number",',
          '  "title": "patent title",',
          '  "relevance": 0.0-1.0,',
          '  "novelty_threat": "anticipates|obvious|adjacent|remote",',
          '  "summary": "2-3 sentence analysis",',
          '  "detailedAnalysis": {',
          '    "relevant_parts": ["overlapping elements"],',
          '    "irrelevant_parts": ["differentiators - what makes invention UNIQUE"],',
          '    "novelty_comparison": "detailed novelty assessment"',
          '  },',
          '  "overlap_features": ["features in both"],',
          '  "missing_features": ["features absent"],',
          '  "novelty_points": ["unique aspects"],',
          '  "confidence": 0.0-1.0',
          '}',
          '',
          'Be HONEST. If patent is highly relevant, say so clearly.',
          '',
          `PN: ${pn}`,
          `Title: ${title || 'Untitled'}`,
          `Abstract: ${maxAbstract || 'N/A'}`,
          `Features: ${JSON.stringify(features)}`,
          `Present: ${JSON.stringify(present)}`,
          `Partial: ${JSON.stringify(partial)}`,
          `Absent: ${JSON.stringify(absent)}`,
          'JSON only.'
        ].join('\n');

        let remarksItem: PerPatentRemark | null = null;
        try {
          const llmResult = await llmGateway.executeLLMOperation(
            { headers: requestHeaders || {} },
            {
              taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
              stageCode: 'NOVELTY_COMPARISON',
              prompt
            }
          );
          if (llmResult.success && llmResult.response?.output) {
            try {
              const parsed = this.parseLLMResponse(llmResult.response.output);
              remarksItem = {
                pn,
                title: parsed.title || title || undefined,
                abstract: maxAbstract || undefined,
                remarks: parsed.remarks || parsed.summary || '',
                overlap_features: Array.isArray(parsed.overlap_features) ? parsed.overlap_features : present,
                missing_features: Array.isArray(parsed.missing_features) ? parsed.missing_features : absent,
                novelty_points: Array.isArray(parsed.novelty_points) ? parsed.novelty_points : [],
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
                // Enhanced detailed analysis fields
                relevance: typeof parsed.relevance === 'number' ? parsed.relevance : undefined,
                novelty_threat: ['anticipates', 'obvious', 'adjacent', 'remote'].includes(parsed.novelty_threat) 
                  ? parsed.novelty_threat : undefined,
                summary: parsed.summary || parsed.remarks || undefined,
                detailedAnalysis: parsed.detailedAnalysis ? {
                  relevant_parts: Array.isArray(parsed.detailedAnalysis.relevant_parts) 
                    ? parsed.detailedAnalysis.relevant_parts : [],
                  irrelevant_parts: Array.isArray(parsed.detailedAnalysis.irrelevant_parts) 
                    ? parsed.detailedAnalysis.irrelevant_parts : [],
                  novelty_comparison: parsed.detailedAnalysis.novelty_comparison || ''
                } : undefined
              };
            } catch {
              // fall through to deterministic fallback
            }
          }
        } catch {
          // ignore, use fallback
        }

        if (!remarksItem) {
          // Fallback deterministic remarks
          const lines: string[] = [];
          if (present.length) lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '...' : ''}.`);
          if (absent.length) lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '...' : ''}.`);
          if (partial.length) lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '...' : ''}.`);
          if (lines.length === 0) lines.push('Insufficient evidence in title/abstract to assess overlap.');
          // Compute relevance score for fallback
          const total = Math.max(1, features.length);
          const relevanceScore = (present.length + partial.length * 0.5) / total;
          const threatLevel = relevanceScore >= 0.7 ? 'anticipates' : relevanceScore >= 0.5 ? 'obvious' : relevanceScore >= 0.3 ? 'adjacent' : 'remote';
          remarksItem = {
            pn,
            title,
            abstract: maxAbstract || undefined,
            remarks: lines.join(' '),
            overlap_features: present,
            missing_features: absent,
            novelty_points: absent.slice(0, 3),
            confidence: undefined,
            relevance: relevanceScore,
            novelty_threat: threatLevel as 'anticipates' | 'obvious' | 'adjacent' | 'remote',
            summary: lines.join(' '),
            detailedAnalysis: {
              relevant_parts: present.map((f: string) => `Patent covers: ${f}`),
              irrelevant_parts: absent.map((f: string) => `Invention unique: ${f}`),
              novelty_comparison: `This patent ${present.length > 0 ? `overlaps on ${present.length} feature(s)` : 'has minimal overlap'} with the invention. ${absent.length > 0 ? `The invention remains differentiated by ${absent.length} unique feature(s).` : ''}`
            }
          };
        }
        // Add deterministic decision to single-call fallback item
        {
          const total = Math.max(1, features.length);
          const presentCount = present.length;
          const partialCount = partial.length;
          const coverage = presentCount / total;
          const critical = (config.stage35a?.criticalFeatures || []);
          const allCriticalPresent = critical.length > 0 ? critical.every(cf => present.includes(cf)) : false;
          const decision: 'obvious' | 'partial_novelty' | 'novel' = (allCriticalPresent && coverage >= 0.6)
            ? 'obvious'
            : ((presentCount + partialCount) / total >= 0.4 ? 'partial_novelty' : 'novel');
          (remarksItem as any).decision = decision;
        }
          perPatentRemarks.push(remarksItem);
        }
      }

      // Merge remarks into stage4Results
      const mergedStage4: any = {
        ...(aggregationResult || {}),
        per_patent_remarks: perPatentRemarks
      };

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          // keep status as STAGE_3_5_COMPLETED; do not mark completed here
          stage4Results: mergedStage4 as any
        }
      });

      return {
        success: true,
        searchId,
        status: (searchRun.status as any),
        currentStage: (searchRun.currentStage as any),
        results: mergedStage4
      };
    } catch (error) {
      console.error('Stage 3.5c execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 3.5c execution failed' };
    }
  }

  // Legacy method for backward compatibility - now delegates to 3.5a + 3.5b
  async executeStage35(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    // First execute 3.5a
    const stage35aResult = await this.executeStage35a(searchId, userId, requestHeaders);
    if (!stage35aResult.success) {
      return stage35aResult;
    }

    // Then execute 3.5b
    return await this.executeStage35b(searchId, userId, requestHeaders);
  }

  /**
   * Get novelty search history for a user, optionally filtered by project
   */
  async getNoveltySearchHistory(userId: string, projectId?: string): Promise<any[]> {
    try {
      const whereClause: any = {
        userId,
        status: {
          in: [
            NoveltySearchStatus.STAGE_1_COMPLETED,
            NoveltySearchStatus.STAGE_3_5_COMPLETED,
            NoveltySearchStatus.COMPLETED
          ]
        }
      };

      if (projectId) {
        whereClause.projectId = projectId;
      }

      const searches = await prisma.noveltySearchRun.findMany({
        where: whereClause,
        include: {
          project: {
            select: {
              id: true,
              name: true
            }
          },
          patent: {
            select: {
              id: true,
              title: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to last 50 searches
      });

      // Format the results for the frontend
      return searches.map(search => ({
        id: search.id,
        title: search.title,
        inventionDescription: search.inventionDescription.substring(0, 200) + (search.inventionDescription.length > 200 ? '...' : ''),
        status: search.status,
        currentStage: search.currentStage,
        createdAt: search.createdAt,
        completedAt: search.stage4CompletedAt,
        project: search.project,
        patent: search.patent,
        hasReport: !!search.reportUrl,
        reportUrl: search.reportUrl,
        results: {
          stage0: search.stage0Results,
          stage1: search.stage1Results ? {
            patentCount: Array.isArray((search.stage1Results as any).pqaiResults) ? (search.stage1Results as any).pqaiResults.length : 0
          } : null,
          stage35: search.stage35Results ? {
            assessmentCount: Array.isArray(search.stage35Results) ? search.stage35Results.length : 0
          } : null,
          stage4: search.stage4Results
        }
      }));

    } catch (error) {
      console.error('Error fetching novelty search history:', error);
      return [];
    }
  }

  /**
   * Execute Stage 4: Report Generation
   */
  /**
   * Resume a failed novelty search from the last completed stage
   */
  async resumeNoveltySearch(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run with all results
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Check if search can be resumed (not completed and not actively running)
      if (searchRun.status === NoveltySearchStatus.COMPLETED) {
        return { success: false, error: 'Search is already completed' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Determine which stage to resume from based on current status
      let resumeFromStage: NoveltySearchStage;
      let newStatus: NoveltySearchStatus;

      switch (searchRun.status) {
        case NoveltySearchStatus.FAILED:
        case NoveltySearchStatus.PENDING:
          resumeFromStage = NoveltySearchStage.STAGE_0;
          newStatus = NoveltySearchStatus.PENDING;
          break;
        case NoveltySearchStatus.STAGE_0_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_1;
          newStatus = NoveltySearchStatus.STAGE_0_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_1_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_3_5;
          newStatus = NoveltySearchStatus.STAGE_1_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_3_5_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_4;
          newStatus = NoveltySearchStatus.STAGE_3_5_COMPLETED;
          break;
        default:
          return { success: false, error: 'Invalid search state for resume' };
      }

      // Reset the search to resumable state
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: newStatus,
          currentStage: resumeFromStage,
          // Clear any error state
          ...(resumeFromStage === NoveltySearchStage.STAGE_0 && { stage0Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_1 && { stage1Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_3_5 && { stage35Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_4 && { stage4Results: undefined }),
        }
      });

      // Execute the stage to resume from
      return await this.executeStage(searchId, resumeFromStage, userId, requestHeaders);

    } catch (error) {
      console.error('Resume search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Resume search failed'
      };
    }
  }

  /**
   * Execute a specific stage (used for resume functionality)
   */
  async executeStage(searchId: string, stage: NoveltySearchStage, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    switch (stage) {
      case NoveltySearchStage.STAGE_0:
        return await this.executeStage0(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_1:
        return await this.executeStage1(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_3_5:
        return await this.executeStage35(searchId, userId, requestHeaders); // This now does 3.5a + 3.5b
      case NoveltySearchStage.STAGE_4:
        return await this.executeStage4(searchId, userId, requestHeaders);
      default:
        return { success: false, error: 'Invalid stage' };
    }
  }

  /**
   * Execute Stage 0: Idea Normalization
   */
  async executeStage0(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Create a minimal user object for stage 0 execution
      // Since we already validated the userId, we can create a basic user object
      const user = { id: userId } as User;

      // Create a request-like object from search data
      // For resume, we don't have the original JWT token, but since we validated userId,
      // we can create a minimal request object
      const request = {
        title: searchRun.title,
        inventionDescription: searchRun.inventionDescription,
        jurisdiction: searchRun.jurisdiction,
        jwtToken: '', // Will be handled by requestHeaders in LLM call
      } as NoveltySearchRequest;

      // Execute stage 0
      const stage0Result = await this.performStage0(searchId, request, config, user, requestHeaders);

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Stage 0 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 0 execution failed'
      };
    }
  }

  async executeStage4(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run with all results
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_4) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Perform Stage 4 report generation
      const stage4Result = await this.performStage4(searchRun, config, requestHeaders);

      if (!stage4Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage4Result.error };
      }

      // Preserve 3.5c remarks in final Stage 4 results
      let finalStage4Data: any = stage4Result.data;
      try {
        const existing = (searchRun.stage4Results as any) || {};
        if (Array.isArray(existing.per_patent_remarks) && existing.per_patent_remarks.length > 0) {
          finalStage4Data = { ...finalStage4Data, per_patent_remarks: existing.per_patent_remarks };
        }
      } catch {}

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.COMPLETED,
          stage4CompletedAt: new Date(),
          stage4Results: finalStage4Data as any,
          reportUrl: stage4Result.reportUrl
        }
      });

      // Increment user's successful novelty searches count
      await prisma.user.update({
        where: { id: userId },
        data: {
          noveltySearchesCompleted: {
            increment: 1
          }
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.COMPLETED,
        results: finalStage4Data
      };

    } catch (error) {
      console.error('Stage 4 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 execution failed'
      };
    }
  }

  // Implementation of individual stages below...

  /**
   * Filter patents for relevance to invention before including in report
   * Uses Gemini 2.5 Flash-Lite model to assess if each patent is actually related to the invention
   */
  private async filterRelevantPatentsForReport(
    stage0Data: NormalizedIdea,
    stage35Data: AssessmentResult[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<AssessmentResult[]> {
    if (!Array.isArray(stage35Data) || stage35Data.length === 0) {
      return [];
    }

    console.log(`ðŸ” Assessing relevance of ${stage35Data.length} patents to invention...`);

    const relevantPatents: AssessmentResult[] = [];

    // Process patents in batches to avoid overwhelming the LLM
    const batchSize = 3;
    for (let i = 0; i < stage35Data.length; i += batchSize) {
      const batch = stage35Data.slice(i, i + batchSize);
      console.log(`ðŸ“‹ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(stage35Data.length / batchSize)} (${batch.length} patents)`);

      for (const patent of batch) {
        try {
          const isRelevant = await this.assessPatentRelevance(
            stage0Data,
            patent,
            config,
            requestHeaders
          );

          if (isRelevant) {
            relevantPatents.push(patent);
            console.log(` Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is relevant - included in report`);
          } else {
            console.log(`âŒ Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is not relevant - excluded from report`);
          }
        } catch (error) {
          console.warn(`âš ï¸ Failed to assess relevance for patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}, including by default:`, error);
          relevantPatents.push(patent); // Include by default if assessment fails
        }
      }

      // Removed intentional delay between batches for faster processing
    }

    return relevantPatents;
  }

  /**
   * Assess if a patent is relevant to the invention using Gemini 2.5 Flash-Lite
   */
  private async assessPatentRelevance(
    stage0Data: NormalizedIdea,
    patent: AssessmentResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<boolean> {
    // Build relevance assessment prompt
    const relevancePrompt = `You are a patent attorney conducting a novelty-oriented relevance review.

INVENTION FEATURES (from user idea):
${JSON.stringify(stage0Data.inventionFeatures || [])}

PATENT TO ASSESS:
- Publication Number: ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}
- Title: ${(patent as any).title || 'Not available'}
- Abstract: ${(patent as any).abstract || 'Not available'}

TASK:
Determine if this patent is RELEVANT to the invention by identifying overlap between the patent's title/abstract and the invention features.

RELEVANCE CRITERIA:
- Patent title/abstract indicates presence of at least one invention feature with technical proximity
- If none of the features appear present, mark as not relevant

OUTPUT FORMAT:
Respond with ONLY a JSON object:
{
  "is_relevant": boolean,
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "brief explanation (max 50 words)"
}

RESPONSE:`;

    try {
      // Use admin-configured model via NOVELTY_RELEVANCE_SCORING stage
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_RELEVANCE_SCORING',
          prompt: relevancePrompt
        }
      );

      if (!llmResult.success) {
        console.warn('Relevance assessment failed, defaulting to relevant');
        return true; // Default to relevant if assessment fails
      }

      if (!llmResult.response) {
        console.warn('No response from relevance assessment, defaulting to relevant');
        return true; // Default to relevant if no response
      }

      const response = this.parseLLMResponse(llmResult.response.output);

      // Check if the response indicates relevance
      if (response && typeof response.is_relevant === 'boolean') {
        return response.is_relevant;
      }

      // If parsing fails, check for keywords in the response
      const output = llmResult.response.output.toLowerCase();
      if (output.includes('"is_relevant": true') || output.includes('"is_relevant":true')) {
        return true;
      }
      if (output.includes('"is_relevant": false') || output.includes('"is_relevant":false')) {
        return false;
      }

      // Default to relevant if we can't determine
      console.warn('Could not parse relevance response, defaulting to relevant');
      return true;

    } catch (error) {
      console.warn('Relevance assessment error, defaulting to relevant:', error instanceof Error ? error.message : String(error));
      return true; // Default to relevant if assessment fails
    }
  }


  private async performStage0(
    searchId: string,
    request: NoveltySearchRequest,
    config: NoveltySearchConfig,
    user: User,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: NormalizedIdea; error?: string }> {
    try {
      console.log('ðŸ§  Starting Stage 0: Idea Normalization');

      // Build prompt
      console.log('ðŸ“ Stage 0 Input - Title:', request.title, 'Description length:', request.inventionDescription?.length);

      const prompt = config.stage0.customPrompt || NOVELTY_SEARCH_NORMALIZATION_PROMPT
        .replace('{title}', request.title || 'Untitled Invention')
        .replace('{rawIdea}', request.inventionDescription || 'No description provided');

      console.log('ðŸ“ Stage 0 Final Prompt:', prompt);

      // Execute LLM call for query generation/normalization using admin-configured model
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_QUERY_GENERATION',  // Stage 0: Query/Feature Generation
          prompt
        }
      );

      if (!llmResult.success) {
        return { success: false, error: llmResult.error instanceof Error ? llmResult.error.message : String(llmResult.error) };
      }

      // Parse response
      console.log('Stage 0 LLM response:', llmResult.response?.output);
      const normalizedData = this.parseLLMResponse(llmResult.response?.output || '');
      console.log('Stage 0 parsed data:', normalizedData);

      // Extract search query and invention features
      const extractedFields: NormalizedIdea = {
        searchQuery: normalizedData?.searchQuery || normalizedData?.query || '',
        inventionFeatures: Array.isArray(normalizedData?.invention_features)
          ? (normalizedData.invention_features as string[]).filter(Boolean)
          : undefined,
        inventionType: Array.isArray(normalizedData?.inventionType) 
          ? normalizedData.inventionType 
          : (normalizedData?.inventionType ? [normalizedData.inventionType] : ['GENERAL'])
      };

      if (!extractedFields.searchQuery) {
        console.warn('No search query found in LLM response, using fallback');
        extractedFields.searchQuery = `${request.title} related technology`.substring(0, 25);
      }

      if (!extractedFields.inventionFeatures || extractedFields.inventionFeatures.length === 0) {
        // Heuristic fallback: split title/idea into candidate tokens
        const seed = `${request.title} ${request.inventionDescription}`.toLowerCase();
        const tokens = seed.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 3);
        extractedFields.inventionFeatures = Array.from(new Set(tokens)).slice(0, 8);
      }

      console.log(' Stage 0 completed successfully');
      return { success: true, data: extractedFields };

    } catch (error) {
      console.error('Stage 0 error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Stage 0 failed: ${errorMessage}`
      };
    }
  }

  private async performStage1(
    searchId: string,
    stage0Data: NormalizedIdea,
    config: NoveltySearchConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      console.log('🔍 Starting Stage 1: Initial Screening');

      // Get patents from PQAI API using searchQuery
      console.log(`🔍 STAGE 1: Starting PQAI search with query: "${stage0Data.searchQuery}"`);
      console.log(`📊 Requesting up to ${config.stage1.maxPatents} patents from PQAI`);

      const pqaiResults = await this.searchPQAI(stage0Data.searchQuery, config.stage1.maxPatents);

      // Return raw PQAI results for UI
      console.log(' Stage 1 completed successfully - found', pqaiResults.length, 'patents');
      return { success: true, data: { pqaiResults } };

    } catch (error) {
      console.error('Stage 1 PQAI search failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PQAI search failed'
      };
    }
  }

  /**
   * Stage 1.5: AI Relevance gate on PQAI results (Gemini 2.5 Flash-Lite)
   * Produces a compact accept/borderline/reject list and a byPn map of scores.
   */
  private async performStage15(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const pqai = Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : [];
      if (pqai.length === 0) return { success: true, data: { accepted: [], borderline: [], rejected: [], byPn: {} } };

      const { thresholds, borderlineQuota, maxCandidates, modelPreference, batchSize } = config.stage15;
      const features = Array.isArray(stage0Data?.inventionFeatures) ? stage0Data.inventionFeatures : [];

      // Use up to maxCandidates for gating
      const candidates = pqai.slice(0, Math.min(maxCandidates, pqai.length));

      // Build batch prompt (10-20 items) so the model returns an array of results
      const buildBatchPrompt = (batch: any[]) => {
        const feats = JSON.stringify(features.slice(0, 8));
        const norm = (v: any, max = 800) => String(v || '').replace(/\s+/g, ' ').substring(0, max);
        const items = batch.map((it, idx) => {
          const pn = it.publication_number || it.publicationNumber || it.pn || it.id || '';
          const title = norm(it.title || '');
          const abstract = norm(it.snippet || it.abstract || it.description || '');
          return `Item ${idx + 1}:\nPN: ${pn}\nTitle: ${title}\nAbstract: ${abstract}`;
        }).join("\n---\n");

        // Keep schema tiny to save tokens; scoring semantics handled client-side with thresholds
        return `You are a patent relevance screener.\nInvention features: ${feats}\n\nFor each patent below, output ONLY a JSON array where each element is {"pn":"<id>","score":0..1,"decision":"accept|borderline|reject"}. Follow the input order.\n\n${items}`;
      };

      // Process in small batches; tolerate failures and fall back to PQAI scores
      const byPn: Record<string, any> = {};
      const accept: string[] = [];
      const borderline: string[] = [];
      const reject: string[] = [];

      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);

        // Run a single LLM call for the whole batch with timeout
        let parsed: any[] | null = null;
        try {
          const prompt = buildBatchPrompt(batch);
          const res = await Promise.race([
            llmGateway.executeLLMOperation(
              { headers: requestHeaders || {} },
              { taskCode: TaskCode.LLM5_NOVELTY_ASSESS, stageCode: 'NOVELTY_COMPARISON', prompt }
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('LLM call timeout')), 30000) // 30 second timeout per batch
            )
          ]) as { success: boolean; response?: any; error?: any };
          if (res.success && res.response?.output) {
            const obj = this.parseLLMResponse(res.response.output);
            if (Array.isArray(obj)) parsed = obj;
          }
        } catch (error) {
          console.warn(`Stage 1.5 batch LLM call failed for batch of ${batch.length} items:`, error);
          // If batching fails, will fall back to PQAI scores below
        }

        // Index parsed results by pn for quick lookup
        const batchMap: Record<string, any> = {};
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            const k = String(r?.pn || '').toUpperCase();
            if (k) batchMap[k] = r;
          }
        }

        // Consolidate each item using parsed array or fallback to PQAI score
        for (const item of batch) {
          const pnRaw = item.publication_number || item.publicationNumber || item.pn || item.id || 'Unknown';
          const k = String(pnRaw).toUpperCase();
          const found = batchMap[k];
          const pqaiScore = item.relevanceScore || item.score || item.relevance || 0;
          const score = (found && typeof found.score === 'number') ? found.score : (typeof pqaiScore === 'number' ? pqaiScore : 0);
          const decision = (found && typeof found.decision === 'string')
            ? found.decision
            : (score >= thresholds.high ? 'accept' : score >= thresholds.medium ? 'borderline' : 'reject');

          byPn[String(pnRaw)] = { pn: String(pnRaw), score, decision };
          if (decision === 'accept') accept.push(String(pnRaw));
          else if (decision === 'borderline') borderline.push(String(pnRaw));
          else reject.push(String(pnRaw));
        }
      }

      // Trim borderline to quota but keep PQAI order
      const canon = (x: any) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '');
      const borderSet = new Set(borderline.map(p => canon(p)));
      const trimmedBorderline: string[] = [];
      for (const r of pqai) {
        const pn = r.publication_number || r.publicationNumber || r.pn || r.id || '';
        if (borderSet.has(canon(pn))) trimmedBorderline.push(String(pn));
        if (trimmedBorderline.length >= borderlineQuota) break;
      }

      return { success: true, data: { accepted: accept, borderline: trimmedBorderline, rejected: reject, byPn, thresholds } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Stage 1.5 gating failed' };
    }
  }

  private async performStage35a(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: FeatureMapBatchResult; error?: string }> {
    try {
      console.log('ðŸ”¬ Starting Stage 3.5a: Feature Mapping Engine');

      const pqaiResults = Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : [];
      const inventionFeatures = stage0Data.inventionFeatures || [];

      if (pqaiResults.length === 0) {
        return { success: false, error: 'No PQAI results available for feature mapping' };
      }

      if (inventionFeatures.length === 0) {
        return { success: false, error: 'No invention features available for mapping' };
      }

      // Sort patents by PQAI relevance score (already sorted in searchPQAI function)
      // Select top 50% of patents (min 10, max 20) for feature analysis
      const totalPatents = pqaiResults.length;
      const targetCount = Math.ceil(totalPatents * 0.5); // Top 50%
      const selectedCount = Math.min(
        Math.max(targetCount, 10), // At least 10 patents
        Math.min(totalPatents, 20) // At most 20 patents, but not more than available
      );

      console.log(`ðŸŽ¯ PATENT SELECTION LOGIC:`);
      console.log(`   - Total patents available: ${totalPatents}`);
      console.log(`   - Target selection (50%): ${targetCount} patents`);
      console.log(`   - Constrained selection: min(10, max(50%, 20)) = ${selectedCount} patents`);
      console.log(`   - Selection percentage: ${((selectedCount/totalPatents)*100).toFixed(1)}%`);

      let selectedPatents: any[] = [];
      const gate = (stage1Data && (stage1Data as any).aiRelevance) ? (stage1Data as any).aiRelevance : null;
      if (gate && (Array.isArray(gate.accepted) || Array.isArray(gate.borderline))) {
        const accepted = Array.isArray(gate.accepted) ? gate.accepted : [];
        const borderline = Array.isArray(gate.borderline) ? gate.borderline : [];
        const canon = (x: any) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '');
        const setA = new Set(accepted.map((s: string) => s.toUpperCase()));
        const setAc = new Set(accepted.map((s: string) => canon(s)));
        const setB = new Set(borderline.map((s: string) => s.toUpperCase()));
        const setBc = new Set(borderline.map((s: string) => canon(s)));

        // Overflow allowances if accepted/borderline exceed the 50% quota
        const accExtra = Math.ceil(totalPatents * (config.stage35a.acceptedOverflowRatio ?? 0.15));
        const borExtra = Math.ceil(totalPatents * (config.stage35a.borderlineOverflowRatio ?? 0.10));
        const maxAccepted = Math.min(accepted.length, selectedCount + accExtra);
        const maxTotalAllowed = selectedCount + accExtra + borExtra;
        console.log('[Stage3.5a][Selection]', {
          totalPatents,
          baseQuota: selectedCount,
          acceptedCount: accepted.length,
          borderlineCount: borderline.length,
          acceptedOverflowAllowed: accExtra,
          borderlineOverflowAllowed: borExtra,
          maxAccepted,
          maxTotalAllowed
        });

        // 1) Accepted first (by PQAI order), up to maxAccepted
        for (const r of pqaiResults) {
          if (selectedPatents.length >= maxAccepted) break;
          const pn = r.publicationNumber || r.pn || r.publication_number || r.id;
          const k = String(pn || '').toUpperCase();
          const kc = canon(pn);
          if (setA.has(k) || setAc.has(kc)) selectedPatents.push(r);
        }

        // 2) Borderline next, while total stays within maxTotalAllowed
        for (const r of pqaiResults) {
          if (selectedPatents.length >= maxTotalAllowed) break;
          if (selectedPatents.includes(r)) continue;
          const pn = r.publicationNumber || r.pn || r.publication_number || r.id;
          const k = String(pn || '').toUpperCase();
          const kc = canon(pn);
          if (setB.has(k) || setBc.has(kc)) selectedPatents.push(r);
        }

        // 3) If still below the base quota (selectedCount), fill from remaining PQAI to reach selectedCount
        for (const r of pqaiResults) {
          if (selectedPatents.length >= selectedCount) break;
          if (!selectedPatents.includes(r)) selectedPatents.push(r);
        }
      } else {
        selectedPatents = pqaiResults.slice(0, selectedCount);
      }

      console.log(`\nðŸ“‹ SELECTED PATENTS FOR STAGE 3.5a ANALYSIS:`);
      selectedPatents.forEach((patent: any, index: number) => {
        const score = patent.relevanceScore;
        const scorePercent = score ? `${(score * 100).toFixed(1)}%` : 'N/A';
        console.log(`   ${index + 1}. ${patent.publicationNumber} - Relevance: ${scorePercent}`);
        console.log(`      Title: "${patent.title?.substring(0, 60)}${patent.title?.length > 60 ? '...' : ''}"`);
      });

      // Log relevance scores statistics for selected patents
      const scores = selectedPatents.map((p: any) => p.relevanceScore || 0).filter((s: number) => s > 0);
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum: number, score: number) => sum + score, 0) / scores.length;
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);

        console.log(`\nðŸ“Š SELECTED PATENTS STATISTICS:`);
        console.log(`   - Average relevance score: ${(avgScore * 100).toFixed(1)}%`);
        console.log(`   - Score range: ${(minScore * 100).toFixed(1)}% - ${(maxScore * 100).toFixed(1)}%`);
        console.log(`   - Score distribution: ${scores.map((s: number) => (s * 100).toFixed(1) + '%').join(', ')}`);
      }

      console.log(`\nðŸš€ PROCEEDING TO STAGE 3.5a FEATURE MAPPING WITH ${selectedCount} PATENTS`);

      // Normalize and canonicalize selected patents
      const normalizedPatents = this.normalizePatentsForFeatureMappingV2(selectedPatents, selectedCount);

      // Process in batches with concurrency
      const batchSize = config.stage35a.batchSize;
      const batches = this.createBatches(normalizedPatents, batchSize);

      console.log(`ðŸ“¦ Processing ${normalizedPatents.length} patents in ${batches.length} batches of ${batchSize}`);

      const allFeatureMaps: PatentFeatureMap[] = [];
      const concurrencyLimit = 2; // As specified in requirements

      // Process batches with controlled concurrency
      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const batchSlice = batches.slice(i, i + concurrencyLimit);
        console.log(`💾 Processing batch group ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(batches.length / concurrencyLimit)}`);

        const batchPromises = batchSlice.map(async (batch, batchIndex) => {
          const batchNumber = i + batchIndex;
          return await this.processFeatureMappingBatch(
            searchId,
            batch,
            inventionFeatures,
            config,
            requestHeaders,
            batchNumber
          );
        });

        const batchResults = await Promise.all(batchPromises);

        // Collect successful results
        for (const result of batchResults) {
          if (result.success && result.featureMaps) {
            allFeatureMaps.push(...result.featureMaps);
          }
        }
      }

      // Compute deterministic per-patent decision and normalize remarks if present
      try {
        const critical = config.stage35a?.criticalFeatures || [];
        const total = Math.max(1, inventionFeatures.length);
        for (const pm of allFeatureMaps) {
          const present = (pm.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Present').map((c: FeatureMapCell) => c.feature);
          const partial = (pm.feature_analysis || []).filter((c: FeatureMapCell) => c.status === 'Partial').map((c: FeatureMapCell) => c.feature);
          const coverage = present.length / total;
          const allCriticalPresent = critical.length > 0 ? critical.every(cf => present.includes(cf)) : false;
          const decision: 'novel'|'partial_novelty'|'obvious' = (allCriticalPresent && coverage >= 0.6)
            ? 'obvious'
            : ((present.length + partial.length) / total >= 0.4 ? 'partial_novelty' : 'novel');
          (pm as any).decision = decision;
          if ((pm as any).remarks) {
            // Normalize whitespace only; do not trim content so full LLM remarks are preserved
            (pm as any).remarks = String((pm as any).remarks).replace(/\s+/g, ' ').trim();
          }
        }
      } catch {}

      // Store results in database
      await this.storeFeatureMapResults(searchId, allFeatureMaps);

      // Calculate quality flags and stats
      const qualityFlags = this.calculateQualityFlags(allFeatureMaps, normalizedPatents);
      const stats = this.calculateFeatureMappingStats(allFeatureMaps, normalizedPatents);

      const result: FeatureMapBatchResult = {
        feature_map: allFeatureMaps,
        quality_flags: qualityFlags,
        stats: stats
      };

      console.log(` Stage 3.5a completed: mapped ${allFeatureMaps.length} patents to ${inventionFeatures.length} features`);
      return { success: true, data: result };

    } catch (error) {
      console.error('Stage 3.5a error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a failed'
      };
    }
  }

  private async performStage35b(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage35aData: FeatureMapBatchResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: AggregationResult; error?: string }> {
    try {
      console.log('ðŸ“Š Starting Stage 3.5b: Aggregation & Risk Analysis');

      const inventionFeatures = stage0Data.inventionFeatures || [];
      const featureMaps = stage35aData.feature_map;
      const qualityFlags = stage35aData.quality_flags;

      if (featureMaps.length === 0) {
        return { success: false, error: 'No feature mapping data available for aggregation' };
      }

      // Compute per-patent coverage
      const perPatentCoverage = this.computePerPatentCoverage(featureMaps, inventionFeatures);

      // Compute per-feature uniqueness
      const perFeatureUniqueness = this.computePerFeatureUniqueness(featureMaps, inventionFeatures);

      // Integration check
      const integrationCheck = this.performIntegrationCheck(featureMaps, inventionFeatures, config.stage35a.criticalFeatures);

      // Compute novelty score
      const noveltyScore = this.computeNoveltyScore(perFeatureUniqueness, config.stage35a.criticalFeatures);

      // Determine decision and confidence
      const { decision, confidence } = this.computeDecisionAndConfidence(
        noveltyScore,
        integrationCheck,
        perFeatureUniqueness,
        featureMaps.length,
        qualityFlags,
        config.stage35a.criticalFeatures
      );

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(
        featureMaps,
        perFeatureUniqueness,
        qualityFlags,
        inventionFeatures
      );

      // Build per-patent remarks from Stage 3.5a maps so Stage 4 and the UI
      // can reuse them without extra LLM calls (each remark kept short and dense).
      const perPatentRemarks: PerPatentRemark[] = featureMaps.map((pm: PatentFeatureMap) => {
        const rawPn = pm.pn || '';
        const pn = String(rawPn).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const coverageEntry = perPatentCoverage.find(c => c.pn === rawPn || c.pn === pn);

        const present = (pm.feature_analysis || [])
          .filter((c: FeatureMapCell) => c.status === 'Present')
          .map((c: FeatureMapCell) => c.feature);
        const partial = (pm.feature_analysis || [])
          .filter((c: FeatureMapCell) => c.status === 'Partial')
          .map((c: FeatureMapCell) => c.feature);
        const absent = inventionFeatures.filter(f => !present.includes(f) && !partial.includes(f));

        let remarks = (pm as any).remarks as string | undefined;
        if (remarks) {
          // Preserve full Stage 3.5a remarks; only normalize whitespace
          remarks = String(remarks).replace(/\s+/g, ' ').trim() || undefined;
        } else {
          const lines: string[] = [];
          if (present.length) {
            lines.push(`Overlaps on: ${present.slice(0, 4).join(', ')}${present.length > 4 ? '…' : ''}.`);
          }
          if (absent.length) {
            lines.push(`Missing vs idea: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? '…' : ''}.`);
          }
          if (partial.length) {
            lines.push(`Partially aligned: ${partial.slice(0, 3).join(', ')}${partial.length > 3 ? '…' : ''}.`);
          }
          if (lines.length === 0) {
            lines.push('Insufficient evidence in title/abstract to assess overlap.');
          }
          remarks = lines.join(' ');
        }

        const decisionLabel = (pm as any).decision || (pm as any).model_decision;
        const confidenceValue =
          typeof coverageEntry?.coverage_ratio === 'number' ? coverageEntry.coverage_ratio : undefined;

        const remark: PerPatentRemark = {
          pn,
          title: pm.title,
          remarks: remarks || '',
          overlap_features: present,
          missing_features: absent,
          novelty_points: [],
          confidence: confidenceValue,
          decision: decisionLabel
        };
        return remark;
      });

      const aggregationResult: AggregationResult = {
        idea_id: searchId,
        per_patent_coverage: perPatentCoverage,
        per_feature_uniqueness: perFeatureUniqueness,
        integration_check: integrationCheck,
        novelty_score: noveltyScore,
        decision,
        confidence,
        risk_factors: riskFactors,
        per_patent_remarks: perPatentRemarks
      };

      // Generate computational feature matrix
      console.log('ðŸ“Š Generating computational feature matrix...');
      const featureMatrix = this.generateFeatureMatrix(
        featureMaps,
        inventionFeatures,
        stage35aData.stats
      );

      if (featureMatrix) {
        // Add matrix to aggregation result for Stage 4
        aggregationResult.feature_matrix = featureMatrix;
        console.log(' Feature matrix generated with', featureMatrix.cells.length, 'cells');
      }

      // Store aggregation snapshot
      await this.storeAggregationSnapshot(searchId, aggregationResult, stage35aData.stats, qualityFlags);

      console.log(` Stage 3.5b completed: ${decision} (score: ${noveltyScore.toFixed(2)}, confidence: ${confidence})`);
      return { success: true, data: aggregationResult };

    } catch (error) {
      console.error('Stage 3.5b error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b aggregation failed'
      };
    }
  }

  /**
   * Generate computational feature matrix from Stage 3.5a results
   */
  private generateFeatureMatrix(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    stage35aStats: any
  ): FeatureMatrix | null {
    try {
      console.log('ðŸ”¢ Building feature matrix for', featureMaps.length, 'patents and', inventionFeatures.length, 'features');

      const cells: FeatureMatrixCell[] = [];
      const patents: string[] = [];
      const patentTitles: Record<string, string> = {};

      // Process each patent
      for (const patentMap of featureMaps) {
        const patentNumber = patentMap.pn;
        patents.push(patentNumber);
        patentTitles[patentNumber] = patentMap.title || 'Unknown Title';

        // Process each feature for this patent
        for (const feature of inventionFeatures) {
          const featureCell = patentMap.feature_analysis?.find(cell => cell.feature === feature);

          if (featureCell) {
            // Use the new format if available, fallback to old format
            const status = featureCell.status === 'Unknown' ? 'Absent' : featureCell.status;
            const evidence = typeof featureCell.evidence === 'string'
              ? featureCell.evidence
              : featureCell.quote || '';
            const reason = featureCell.reason || '';
            const confidence = featureCell.confidence;

            cells.push({
              patentNumber,
              feature,
              status,
              confidence,
              evidence,
              reason
            });
          } else {
            // No analysis available for this feature-patent combination
            cells.push({
              patentNumber,
              feature,
              status: 'Absent',
              reason: 'No analysis available'
            });
          }
        }
      }

      // Calculate LLM usage from Stage 3.5a stats
      const llmUsage = {
        totalCalls: stage35aStats?.patents_analyzed || featureMaps.length,
        totalInputTokens: 0, // Would need to aggregate from actual LLM calls
        totalOutputTokens: 0, // Would need to aggregate from actual LLM calls
        totalCost: 0 // Would need to calculate based on model and tokens
      };

      const matrix: FeatureMatrix = {
        patents,
        features: inventionFeatures,
        cells,
        patentTitles,
        llmUsage
      };

      console.log('ðŸ“Š Matrix generated:', {
        patents: patents.length,
        features: inventionFeatures.length,
        totalCells: cells.length,
        presentCount: cells.filter(c => c.status === 'Present').length,
        partialCount: cells.filter(c => c.status === 'Partial').length,
        absentCount: cells.filter(c => c.status === 'Absent').length
      });

      return matrix;

    } catch (error) {
      console.error('âŒ Error generating feature matrix:', error);
      return null;
    }
  }

  /**
   * Generate fallback narrative when LLM fails
   */
  private generateFallbackNarrative(
    aggregationResult: AggregationResult,
    perFeatureUniqueness: any[],
    integrationCheck: any,
    decision: string
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const uniqueFeatures = perFeatureUniqueness.filter(f => f.uniqueness > 0.8).length;
    const totalFeatures = perFeatureUniqueness.length;

    return {
      integration: integrationCheck.any_single_patent_covers_majority === false
        ? "None of the reviewed patents integrate more than 60% of the identified features, indicating the combination is novel rather than the individual components."
        : "Some patents show significant feature integration, suggesting moderate novelty at the system level.",

      feature_insights: `Analysis reveals ${uniqueFeatures} of ${totalFeatures} features with high uniqueness (>80%). Features related to core functionality show ${(uniqueFeatures/totalFeatures * 100).toFixed(0)}% uniqueness across the patent landscape.`,

      verdict: `The data supports a ${decision.toLowerCase()} determination with ${score}% novelty score and ${aggregationResult.confidence.toLowerCase()} confidence. The feature-level analysis demonstrates strong technical differentiation.`
    };
  }

  /**
   * Prepare inputs for report generation
   */
  private prepareReportInputs(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMapCells: any[],
    config: NoveltySearchConfig
  ): any {
    // Get top patents by coverage for metadata
    const topPatents = aggregationResult.per_patent_coverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, 10);

    const patent_metadata = topPatents.map(patent => {
      const cell = featureMapCells.find(c => c.publicationNumber === patent.pn);
      return {
        publication_number: patent.pn,
        title: cell?.title || 'Unknown Title',
        abstract: (cell?.abstract || '').substring(0, 300),
        year: cell?.year || '',
        country: patent.pn.substring(0, 2),
        inventors: cell?.inventors || []
      };
    });

    return {
      patent_metadata,
      feature_map_cells: featureMapCells,
      stage0_data: stage0Data
    };
  }

  /**
   * Generate fallback report data when LLM fails
   */
  private generateFallbackReportData(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    config: NoveltySearchConfig,
    selectedPatents?: any[]
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const uniqueFeatures = aggregationResult.per_feature_uniqueness.filter(f => f.uniqueness > 0.8).length;
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const selectedCount = selectedPatents?.length || 0;

    // Generate citations table from selected patents
    const citationsTable = selectedPatents?.map((patent, index) => ({
      s_no: index + 1,
      citation_no: patent.patentNumber,
      title: `Patent ${patent.patentNumber}`, // Fallback title
      publication_date: "Unknown",
      link: `https://patents.google.com/patent/${patent.patentNumber}`
    })) || [];

    return {
      // Include search query from stage 0 data
      search_query: stage0Data?.searchQuery || '',
      table_of_contents: {
        title: "Table Of Contents",
        sections: [
          {"number": "01", "title": "Report", "page": "3", "link": "#report"},
          {"number": "1.1", "title": "Search Metadata Index", "page": "3", "link": "#metadata"},
          {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
          {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
          {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
          {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
          {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
        ]
      },
      report_metadata: {
        title: "Novelty Assessment Report",
        search_id: searchRun.id,
        date: new Date().toISOString().split('T')[0],
        analyst: "SpotIPR AI",
        total_patents_analyzed: aggregationResult.per_patent_coverage.length.toString(),
        selected_patents_count: selectedCount.toString()
      },
      section_1_1_search_metadata: {
        anchor: "metadata",
        search_id: searchRun.id,
        search_date: searchRun.createdAt,
        jurisdiction: config.jurisdiction,
        total_patents_found: aggregationResult.per_patent_coverage.length,
        selection_criteria: `Top 25% most relevant patents selected for detailed analysis (${selectedCount} patents)`
      },
      section_1_2_key_features: {
        anchor: "key-features",
        title: "Key Features Generated from Search Query",
        features_table: (stage0Data.inventionFeatures || []).map((feature, index) => ({
          number: index + 1,
          description: feature
        }))
      },
      section_1_3_summary: {
        anchor: "summary",
        title: "Summary",
        description: `Based on the details of the invention, relevant patent citations are mapped. Further, ${selectedCount} other patent citations are also shortlisted. Only one patent per family is being mapped and other family members of the family are incorporated by reference. Summary of the citations is presented in the tables below.`,
        citations_table: citationsTable
      },
      section_1_4_feature_analysis: {
        anchor: "feature-analysis",
        title: "Key Feature Analysis",
        description: "The broad key features are prepared based on the details of the invention and information provided by the client. The analysis of the references has been done based on one or more features overlapping with the key features of the invention to form a relevant prior art.",
        feature_matrix: {
          patent_numbers: selectedPatents?.map(p => p.patentNumber) || [],
          features: (stage0Data.inventionFeatures || []).map((feature, index) => ({
            name: `KF${index + 1}`,
            description: feature
          })),
          overlap_data: selectedPatents?.map(patent => ({
            patent: patent.patentNumber,
            ...Object.fromEntries(
              (stage0Data.inventionFeatures || []).map((feature, index) => [
                `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage ?
                `${(patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0).toFixed(1)}%` :
                  "0.0%"
              ])
            )
          })) || []
        }
      },
      section_2_1_patent_details: {
        anchor: "patent-details",
        title: "Details of Relevant Patent Citations",
        patents: selectedPatents?.map(patent => ({
          patent_number: patent.patentNumber,
          anchor: `patent_${patent.patentNumber}`,
          basic_info: {
            title: `Patent ${patent.patentNumber}`,
            publication_number: patent.patentNumber,
            filing_date: "Unknown",
            publication_date: "Unknown",
            applicant: "Unknown",
            inventor: "Unknown",
            cpc_codes: [],
            abstract: "Patent details not available in fallback mode"
          },
          feature_comparison: {
            title: "Feature-by-Feature Analysis",
            comparisons: (stage0Data.inventionFeatures || []).map(feature => ({
              feature: feature,
              patent_implementation: "Analysis not available in fallback mode",
              searched_idea: feature,
              similarity: "Unknown",
              novelty_impact: "Analysis not available in fallback mode"
            }))
          },
          attorney_analysis: {
            title: "Patent Attorney Analysis",
            relation_to_idea: "Detailed analysis not available in fallback mode",
            existing_coverage: `Coverage ratio: ${(patent.coverageRatio * 100).toFixed(1)}%`,
            novel_elements: "Analysis not available in fallback mode",
            recommendations: "Please regenerate report for detailed analysis"
          }
        })) || []
      },
      concluding_remarks: {
        title: "Final Concluding Remarks",
        overall_novelty_assessment: aggregationResult.decision,
        key_strengths: [
          `Novelty score: ${score}%`,
          `${uniqueFeatures} out of ${totalFeatures} features show high uniqueness`
        ],
        key_risks: [
          "Limited patent details in fallback mode",
          "Detailed analysis not available"
        ],
        strategic_recommendations: aggregationResult.decision === 'Novel' ?
          ["Proceed with patent filing", "Consider broad claim scope"] :
          ["Narrow claims to unique features", "Consider alternative IP protection"],
        filing_advice: aggregationResult.decision === 'Novel' ?
          "Strong patentability prospects - proceed with filing" :
          "Moderate patentability - review claims and consider amendments"
      }
    };
  }

  /**
   * Enhance LLM-generated report with deterministic data and professional patent analysis remarks
   */
  private enhanceReportWithDeterministicData(
    llmReport: any,
    aggregationResult: AggregationResult,
    reportInputs: any
  ): any {
    // Build deterministic summary explaining why novelty exists
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const highlyUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness > 0.8)
      .sort((a, b) => b.uniqueness - a.uniqueness);
    const moderateUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness > 0.5 && f.uniqueness <= 0.8);
    const lowUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness <= 0.5);
    const topUniqueNames = highlyUnique.slice(0, 3).map(f => f.feature);
    const integration = aggregationResult.integration_check;
    const score = aggregationResult.novelty_score;
    const decision = aggregationResult.decision;

    // Professional integration analysis
    const integrationLine = integration?.any_single_patent_covers_majority === false
      ? 'No single prior-art reference discloses a majority of the claimed features in combination, supporting system-level novelty arising from the specific integration of these elements.'
      : (integration?.explanation || 'Several references exhibit partial feature overlap; patentability depends on the claim scope and the specific combination of elements.');

    // Professional executive summary
    const deterministicSummary = this.buildProfessionalExecutiveSummary(
      totalFeatures, highlyUnique.length, moderateUnique.length, lowUnique.length,
      topUniqueNames, integrationLine, decision, score, aggregationResult.confidence
    );

    const existingExec = llmReport?.executive_summary || {};
    const finalExec = {
      ...existingExec,
      summary: existingExec.summary || existingExec.text || deterministicSummary,
      novelty_score: (score * 100).toFixed(1) + "%",
      confidence: aggregationResult.confidence,
      visual_cards: {
        "Novelty Score": (score * 100).toFixed(1) + "%",
        "Patents Analyzed": aggregationResult.per_patent_coverage.length.toString(),
        "Unique Features": `${highlyUnique.length} of ${totalFeatures}`,
        "Confidence": aggregationResult.confidence
      }
    };

    // Enhanced professional concluding remarks
    const existingRemarks = llmReport?.concluding_remarks || {};
    const professionalRemarks = this.buildProfessionalConcludingRemarks(
      existingRemarks, aggregationResult, topUniqueNames, highlyUnique, 
      moderateUnique, lowUnique, integrationLine, reportInputs
    );

    // Ensure deterministic data overrides any LLM hallucinations
    return {
      ...llmReport,
      // Include search query from stage 0 data
      search_query: reportInputs.stage0_data?.searchQuery || '',
      executive_summary: finalExec,
      feature_uniqueness_table: aggregationResult.per_feature_uniqueness.map(f => ({
        feature: f.feature,
        uniqueness: (f.uniqueness * 100).toFixed(1) + "%",
        color: f.uniqueness > 0.8 ? "#4CAF50" : f.uniqueness > 0.6 ? "#FFC107" : "#E53935"
      })),
      concluding_remarks: professionalRemarks,
      // Add patent metadata
      relevant_patent_summaries: reportInputs.patent_metadata
    };
  }

  /**
   * Build professional executive summary suitable for inventor review
   */
  private buildProfessionalExecutiveSummary(
    totalFeatures: number, highCount: number, modCount: number, lowCount: number,
    topUniqueNames: string[], integrationLine: string, decision: string, 
    score: number, confidence: string
  ): string {
    const scorePercent = (score * 100).toFixed(1);
    
    let verdictPhrase = '';
    let actionPhrase = '';
    
    if (decision === 'Novel') {
      verdictPhrase = 'The invention demonstrates strong novelty characteristics';
      actionPhrase = 'Recommend proceeding with patent application preparation.';
    } else if (decision === 'Partially Novel') {
      verdictPhrase = 'The invention exhibits partial novelty with identifiable differentiation points';
      actionPhrase = 'Recommend focusing claims on unique feature combinations and considering design-arounds for overlapping elements.';
    } else if (decision === 'Not Novel') {
      verdictPhrase = 'Significant prior art overlap has been identified';
      actionPhrase = 'Recommend re-evaluating the invention scope or pivoting to unique aspects not covered by prior art.';
    } else {
      verdictPhrase = 'Limited prior art was identified for comprehensive assessment';
      actionPhrase = 'Consider expanding the search or proceeding with caution.';
    }

    let featureAnalysis = `Feature-level analysis across ${totalFeatures} key invention features indicates: `;
    if (highCount > 0) {
      featureAnalysis += `${highCount} feature(s) demonstrate high uniqueness (>80%)`;
      if (topUniqueNames.length > 0) {
        featureAnalysis += `, notably ${topUniqueNames.slice(0, 2).join(' and ')}`;
      }
      featureAnalysis += '. ';
    }
    if (modCount > 0) {
      featureAnalysis += `${modCount} feature(s) show moderate differentiation (50-80%). `;
    }
    if (lowCount > 0) {
      featureAnalysis += `${lowCount} feature(s) have substantial prior art coverage requiring claim refinement. `;
    }

    return `${verdictPhrase} with a calculated novelty score of ${scorePercent}% (${confidence.toLowerCase()} confidence). ${featureAnalysis}${integrationLine} ${actionPhrase}`;
  }

  /**
   * Build comprehensive professional concluding remarks for patent analysis report
   */
  private buildProfessionalConcludingRemarks(
    existingRemarks: any,
    aggregationResult: AggregationResult,
    topUniqueNames: string[],
    highlyUnique: any[],
    moderateUnique: any[],
    lowUnique: any[],
    integrationLine: string,
    reportInputs: any
  ): any {
    const decision = aggregationResult.decision;
    const score = aggregationResult.novelty_score;
    const confidence = aggregationResult.confidence;

    // Build professional key strengths based on analysis
    const keyStrengths: string[] = [];
    if (highlyUnique.length > 0) {
      keyStrengths.push(`${highlyUnique.length} core feature(s) demonstrate high uniqueness (>80%), providing strong claim support`);
      if (topUniqueNames.length > 0) {
        keyStrengths.push(`Primary differentiators identified: ${topUniqueNames.join(', ')}`);
      }
    }
    if (aggregationResult.integration_check?.any_single_patent_covers_majority === false) {
      keyStrengths.push('No single prior art reference covers the majority of features, indicating system-level novelty');
    }
    if (score >= 0.7) {
      keyStrengths.push('Overall novelty score exceeds 70%, suggesting favorable patentability prospects');
    }
    if (confidence === 'High') {
      keyStrengths.push('High confidence in assessment based on comprehensive prior art coverage');
    }

    // Build professional key risks
    const keyRisks: string[] = [];
    if (lowUnique.length > 0) {
      keyRisks.push(`${lowUnique.length} feature(s) have substantial prior art overlap (≤50% uniqueness) - consider claim narrowing`);
      const riskFeatures = lowUnique.slice(0, 2).map(f => f.feature);
      if (riskFeatures.length > 0) {
        keyRisks.push(`Features requiring attention: ${riskFeatures.join(', ')}`);
      }
    }
    if (decision === 'Not Novel' || decision === 'Partially Novel') {
      keyRisks.push('Prior art citations may be combined under obviousness analysis (35 U.S.C. § 103)');
    }
    if (confidence === 'Low') {
      keyRisks.push('Limited prior art coverage may indicate undiscovered references - consider supplemental search');
    }
    if (aggregationResult.per_patent_coverage.some(p => p.coverage_ratio > 0.7)) {
      keyRisks.push('One or more references show high feature coverage (>70%) - review for potential anticipation');
    }

    // Build strategic recommendations for inventors
    const recommendations: string[] = [];
    if (decision === 'Novel') {
      recommendations.push('Proceed with drafting claims emphasizing the identified high-uniqueness features');
      recommendations.push('Consider filing provisional application to establish priority date');
      recommendations.push('Conduct freedom-to-operate analysis for commercial implementation');
    } else if (decision === 'Partially Novel') {
      recommendations.push('Focus independent claims on the combination of high-uniqueness features');
      recommendations.push('Draft dependent claims to capture alternative embodiments');
      recommendations.push('Consider design-around opportunities for features with prior art overlap');
      recommendations.push('Document technical advantages of the specific combination');
    } else {
      recommendations.push('Re-evaluate invention disclosure with focus on novel technical contributions');
      recommendations.push('Consider pivoting to unexplored aspects of the technology');
      recommendations.push('Identify any secondary considerations (unexpected results, commercial success) that may support patentability');
      recommendations.push('Consult with patent counsel before proceeding');
    }

    // Build filing advice
    let filingAdvice = '';
    if (decision === 'Novel') {
      filingAdvice = 'Based on this analysis, the invention appears to meet the novelty and non-obviousness requirements under 35 U.S.C. §§ 102 and 103. Recommend proceeding with patent application preparation with focus on the identified differentiators.';
    } else if (decision === 'Partially Novel') {
      filingAdvice = 'The invention shows patentable subject matter, but claim scope may need refinement. Recommend working with patent counsel to focus claims on the unique feature combinations while avoiding prior art overlap.';
    } else if (decision === 'Not Novel') {
      filingAdvice = 'Significant prior art overlap suggests challenges meeting novelty requirements. Recommend inventor consultation to identify any unconsidered aspects or technical improvements that may distinguish from prior art.';
    } else {
      filingAdvice = 'Insufficient prior art for definitive assessment. Consider expanded search before making filing decisions.';
    }

    // Build "why novelty exists" explanation
    const uniqueFeaturesText = topUniqueNames.length > 0 
      ? topUniqueNames.slice(0, 3).join(', ') 
      : 'key technical features';
    const whyNovel = highlyUnique.length > 0 
      ? `Novelty determination is primarily supported by ${highlyUnique.length} feature(s) showing high uniqueness: ${uniqueFeaturesText}. ${integrationLine} The inventive contribution lies in the specific configuration and technical integration of these elements.`
      : `The novelty assessment is based on the overall feature mapping analysis. ${integrationLine}`;

    // Build inventor action items
    const inventorActions: string[] = [];
    if (lowUnique.length > 0) {
      inventorActions.push(`Review overlapping features (${lowUnique.map(f => f.feature).slice(0, 2).join(', ')}) and document any technical distinctions not captured in the analysis`);
    }
    if (decision !== 'Novel') {
      inventorActions.push('Provide additional technical details that may distinguish from cited prior art');
      inventorActions.push('Identify any performance improvements, efficiency gains, or unexpected results');
    }
    inventorActions.push('Review cited prior art references and note any mischaracterizations');
    inventorActions.push('Document the problem being solved and why prior art solutions are inadequate');

    return {
      ...existingRemarks,
      title: 'Final Assessment & Recommendations',
      overall_novelty_assessment: existingRemarks.overall_novelty_assessment || decision,
      novelty_score_summary: `${(score * 100).toFixed(1)}% novelty score with ${confidence.toLowerCase()} confidence`,
      why_novelty_exists: existingRemarks.why_novelty_exists || whyNovel,
      key_strengths: existingRemarks.key_strengths?.length > 0 ? existingRemarks.key_strengths : keyStrengths,
      key_risks: existingRemarks.key_risks?.length > 0 ? existingRemarks.key_risks : keyRisks,
      strategic_recommendations: existingRemarks.strategic_recommendations?.length > 0 ? existingRemarks.strategic_recommendations : recommendations,
      filing_advice: existingRemarks.filing_advice || filingAdvice,
      inventor_action_items: inventorActions,
      analysis_date: new Date().toISOString().split('T')[0],
      disclaimer: 'This analysis is AI-generated and should be reviewed by a qualified patent attorney before making legal or business decisions. Patent law is complex and fact-specific; this report does not constitute legal advice.'
    };
  }

  // Stage 4 Helper Methods

  private async getFeatureMapCellsWithOverrides(searchId: string): Promise<any[]> {
    // Get cells with overrides applied
    const cells = await (prisma as any).featureMapCell.findMany({
      where: { searchId },
      include: {
        overrides: true // Include any overrides
      }
    });

    // Apply overrides
    return cells.map((cell: any) => {
      const override = cell.overrides?.[0]; // Latest override if any
      if (override) {
        return {
          ...cell,
          status: override.overriddenStatus,
          evidence: override.evidence || cell.evidence,
          overridden: true,
          overrideReason: override.reason
        };
      }
      return { ...cell, overridden: false };
    });
  }

  private selectTopPatentsForDetailedAnalysis(
    perPatentCoverage: PerPatentCoverage[],
    featureMapCells: any[],
    inventionFeatures: string[],
    stage1PQAI?: any[]
  ): any[] {
    // Compute global feature scarcity to prioritize patents covering rarer features
    const featureStats = new Map<string, { present: number; partial: number }>();
    for (const cell of featureMapCells || []) {
      const f = (cell.feature_text || cell.feature || '').toLowerCase();
      if (!f) continue;
      const s = (cell.status || '').toString();
      const entry = featureStats.get(f) || { present: 0, partial: 0 };
      if (s === 'Present') entry.present += 1;
      else if (s === 'Partial') entry.partial += 1;
      featureStats.set(f, entry);
    }
    const scarcityWeight = (feat: string): number => {
      const key = (feat || '').toLowerCase();
      const st = featureStats.get(key) || { present: 0, partial: 0 };
      // Rarer features get higher weight; clamp to [0.2, 1.0]
      const raw = 1 / (1 + st.present + 0.5 * st.partial);
      return Math.max(0.2, Math.min(1.0, raw));
    };
    // Pre-index PQAI results by publication number for relevance/abstract lookup
    const pqaiByPn = new Map<string, any>();
    if (Array.isArray(stage1PQAI)) {
      for (const r of stage1PQAI) {
        const pn = r.publicationNumber || r.pn || r.patent_number || r.publication_number;
        if (pn) pqaiByPn.set(pn, r);
      }
    }

    // Calculate relevance score for each patent based on coverage ratio and feature overlap
    const featureCount = inventionFeatures.length || 0;

    const scored = perPatentCoverage
      // Filter to only patents with at least one Present or Partial feature
      .filter(p => (p.present_count || 0) + (p.partial_count || 0) > 0)
      .map(patent => {
      // Find feature mappings for this patent
      const patentMappings = featureMapCells.filter(cell =>
        (cell.patent_publication_number || cell.publicationNumber) === patent.pn
      );

      // Calculate average feature overlap percentage
      const featureOverlaps = inventionFeatures.map(feature => {
        const mapping = patentMappings.find((m: any) =>
          m.feature_text?.toLowerCase() === feature.toLowerCase()
        );
        return mapping ? (mapping.overlap_percentage || 0) : 0;
      });

      const avgFeatureOverlap = featureOverlaps.reduce((sum, overlap) => sum + overlap, 0) / featureOverlaps.length;

      // Combine coverage ratio and feature overlap for final score
      const relevanceScore = (patent.coverage_ratio * 0.6) + (avgFeatureOverlap * 0.4);

      const pq = pqaiByPn.get(patent.pn) || {};
      const pqaiRelevance = pq.relevanceScore || pq.score || pq.relevance || 0;
      const abstract = pq.abstract || pq.snippet || pq.description || '';

      const presentPartial = (patent.present_count || 0) + (patent.partial_count || 0);
      const allFeaturesCovered = featureCount > 0 && presentPartial >= featureCount;

      return {
        patentNumber: patent.pn,
        coverageRatio: patent.coverage_ratio,
        avgFeatureOverlap: avgFeatureOverlap,
        relevanceScore: relevanceScore,
        pqaiRelevance,
        abstract,
        allFeaturesCovered,
        mappings: patentMappings
      };
    });

    // If multiple patents cover all features, keep only top 2 by PQAI relevance to save tokens
    const fullCover = scored.filter(s => s.allFeaturesCovered);
    if (fullCover.length >= 2) {
      const topByPQAI = [...fullCover].sort((a, b) => (b.pqaiRelevance || 0) - (a.pqaiRelevance || 0)).slice(0, 2);
      console.log(`🎯 All-feature coverage detected. Limiting to top ${topByPQAI.length} by PQAI relevance.`);
      return topByPQAI;
    }

    // Otherwise, if we have > 2 intersecting patents, select up to 2 that maximize unique feature coverage (Present>Partial)
    if (scored.length > 2) {
      const featureSet = new Set(inventionFeatures.map(f => f.toLowerCase()));
      const covered = new Set<string>();

      // Helper to compute marginal gain for a patent given currently covered features
      const marginalGain = (pat: any): number => {
        let gain = 0;
        for (const m of pat.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat || !featureSet.has(feat) || covered.has(feat)) continue;
          const status = (m.status || '').toString();
          const w = scarcityWeight(feat);
          if (status === 'Present') gain += 1.0 * w;
          else if (status === 'Partial') gain += 0.5 * w;
        }
        // Lightly include PQAI relevance as tie-breaker signal
        gain += (pat.pqaiRelevance || 0) * 0.05;
        return gain;
      };

      const pool = [...scored].sort((a, b) => b.relevanceScore - a.relevanceScore);
      const chosen: any[] = [];
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        // Pick patent with highest marginal coverage gain; tie-break by relevance
        pool.sort((a, b) => {
          const ga = marginalGain(a), gb = marginalGain(b);
          if (gb !== ga) return gb - ga;
          return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        });
        const pick = pool.shift();
        if (!pick) break;
        chosen.push(pick);
        // Update covered features with this pick
        for (const m of pick.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat) continue;
          const status = (m.status || '').toString();
          if (status === 'Present' || status === 'Partial') covered.add(feat);
        }
      }
      console.log(`ðŸ§  Greedy selection picked ${chosen.length} patents to maximize evidence coverage.`);
      return chosen;
    }

    // If 1â€“2 intersecting patents, return them as-is
    const patentScores = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`ðŸ“Š Passing ${patentScores.length} intersecting patents to Stage 4 (out of filtered set).`);
    return patentScores;
  }

  private buildFeaturePatentMatrix(
    inventionFeatures: string[],
    featureMapCells: any[],
    maxRefs: number
  ): any {
    // Group cells by publication number and sort by coverage
    const patentGroups: { [pn: string]: any } = {};

    for (const cell of featureMapCells) {
      if (!patentGroups[cell.publicationNumber]) {
        patentGroups[cell.publicationNumber] = {
          pn: cell.publicationNumber,
          cells: [],
          presentCount: 0,
          totalCount: inventionFeatures.length
        };
      }

      patentGroups[cell.publicationNumber].cells.push({
        feature: cell.feature,
        status: cell.status,
        evidence: cell.evidence
      });

      if (cell.status === 'Present') {
        patentGroups[cell.publicationNumber].presentCount++;
      }
    }

    // Sort patents by coverage ratio and take top N
    const sortedPatents = Object.values(patentGroups)
      .map((p: any) => ({
        ...p,
        coverageRatio: p.presentCount / p.totalCount
      }))
      .sort((a: any, b: any) => b.coverageRatio - a.coverageRatio)
      .slice(0, maxRefs);

    return {
      rows: inventionFeatures,
      cols: sortedPatents.map((p: any) => p.pn),
      cells: sortedPatents.map((p: any) =>
        inventionFeatures.map(feature => {
          const cell = p.cells.find((c: any) => c.feature === feature);
          return cell ? cell.status : 'Unknown';
        })
      ),
      coverageRatios: sortedPatents.map((p: any) => p.coverageRatio)
    };
  }

  private getTopReferences(perPatentCoverage: PerPatentCoverage[], maxRefs: number): any[] {
    return perPatentCoverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, maxRefs)
      .map(coverage => ({
        pn: coverage.pn,
        coverage_ratio: coverage.coverage_ratio,
        year: '2023', // Would need to get from PQAI data
        country: 'US', // Would need to get from PQAI data
        assignee: 'Unknown' // Would need to get from PQAI data
      }));
  }

  /**
   * Select patents for Stage 4 using a costâ€‘effective greedy coverage heuristic:
   * - Treat all features equally; prefer Present over Partial.
   * - Cover each feature with Present if any Present exists in the dataset; otherwise allow Partial.
   * - Rank pool by coverage+overlap; then iteratively add the patent with highest marginal gain.
   * - Add one extra precision patent if only Partial is possible for remaining features.
   */
  private selectPatentsByGreedyCoverage(
    perPatentCoverage: PerPatentCoverage[],
    featureMapCells: any[],
    inventionFeatures: string[],
    stage1PQAI?: any[]
  ): any[] {
    const pqaiByPn = new Map<string, any>();
    if (Array.isArray(stage1PQAI)) {
      for (const r of stage1PQAI) {
        const pn = r.publicationNumber || r.pn || r.patent_number || r.publication_number || r.id;
        if (pn) pqaiByPn.set(pn, r);
      }
    }

    // Index mappings per PN
    const mappingsByPn: Record<string, any[]> = {};
    for (const cell of featureMapCells || []) {
      const pn = cell.patent_publication_number || cell.publicationNumber;
      if (!pn) continue;
      (mappingsByPn[pn] ||= []).push(cell);
    }

    // Determine which features have any Present evidence at all
    const presentPossible: Record<string, boolean> = {};
    for (const f of inventionFeatures) presentPossible[f.toLowerCase()] = false;
    for (const cell of featureMapCells || []) {
      const f = (cell.feature_text || cell.feature || '').toLowerCase();
      if (!f) continue;
      if ((cell.status || '').toString() === 'Present') presentPossible[f] = true;
    }

    // Score pool for ordering
    const scored = perPatentCoverage
      .filter(p => (p.present_count || 0) + (p.partial_count || 0) > 0)
      .map(p => {
        const maps = mappingsByPn[p.pn] || [];
        const pq = pqaiByPn.get(p.pn) || {};
        const pqaiRelevance = pq.relevanceScore || pq.score || pq.relevance || 0;
        const abstract = pq.abstract || pq.snippet || pq.description || '';
        const title = pq.title || pq.invention_title || 'Untitled Patent';
        const link = pq.link || `https://patents.google.com/patent/${p.pn}`;
        const overlaps = inventionFeatures.map(feat => {
          const m = maps.find(mm => ((mm.feature_text || mm.feature || '') as string).toLowerCase() === feat.toLowerCase());
          return m ? (m.overlap_percentage || 0) : 0;
        });
        const avgFeatureOverlap = overlaps.length ? overlaps.reduce((a,b)=>a+b,0)/overlaps.length : 0;
        const relevanceScore = (p.coverage_ratio * 0.6) + (avgFeatureOverlap * 0.4);
        return {
          patentNumber: p.pn,
          coverageRatio: p.coverage_ratio,
          avgFeatureOverlap,
          relevanceScore,
          pqaiRelevance,
          abstract,
          title,
          mappings: maps,
          link
        };
      })
      .sort((a,b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    const uncovered = new Set(inventionFeatures.map(f => f.toLowerCase()));
    const selected: any[] = [];

    const marginalGain = (pat: any): {gain: number; details: {feat: string; kind: 'P'|'Pt'}[]} => {
      let gain = 0; const details: any[] = [];
      for (const m of pat.mappings as any[]) {
        const feat = ((m.feature_text || m.feature || '') as string).toLowerCase();
        if (!uncovered.has(feat)) continue;
        const status = (m.status || '').toString();
        if (status === 'Present') { gain += 1; details.push({feat, kind: 'P'}); }
        else if (status === 'Partial' && !presentPossible[feat]) { gain += 0.5; details.push({feat, kind: 'Pt'}); }
      }
      gain += (pat.pqaiRelevance || 0) * 0.01; // tiny tieâ€‘break
      return { gain, details };
    };

    while (uncovered.size > 0) {
      let best: any = null; let bestGain = -1; let bestDetails: any[] = [];
      for (const cand of scored) {
        if (selected.find(s => s.patentNumber === cand.patentNumber)) continue;
        const { gain, details } = marginalGain(cand);
        if (gain > bestGain || (gain === bestGain && (cand.relevanceScore||0) > (best?.relevanceScore||0))) {
          best = cand; bestGain = gain; bestDetails = details;
        }
      }
      if (!best || bestGain <= 0) break; // no more gains
      selected.push(best);
      for (const d of bestDetails) uncovered.delete(d.feat);
      // Reasonable stop: if selected reaches 5 and majority covered, let Stage 4 narrate residuals
      if (selected.length >= 5 && uncovered.size <= Math.ceil(inventionFeatures.length * 0.1)) break;
    }

    // One extra precision pick for Partialâ€‘only residuals
    if (uncovered.size > 0) {
      let best: any = null; let bestPt = -1;
      for (const cand of scored) {
        if (selected.find(s => s.patentNumber === cand.patentNumber)) continue;
        let count = 0;
      for (const m of cand.mappings as any[]) {
          const feat = ((m.feature_text || m.feature || '') as string).toLowerCase();
          if (!uncovered.has(feat)) continue;
          if ((m.status || '').toString() === 'Partial' && !presentPossible[feat]) count++;
      }
        if (count > bestPt) { bestPt = count; best = cand; }
      }
      if (best && bestPt > 0) selected.push(best);
    }

    if (selected.length === 0 && scored.length > 0) {
      // Safety net: ensure at least top 2 are passed if greedy found no gains due to schema mismatches
      console.warn(' Greedy selector produced empty set; falling back to top-2 by relevance.');
      return scored.slice(0, Math.min(2, scored.length));
    }

    console.log(` Selected ${selected.length} patents for Stage 4 by greedy feature coverage.`);
    return selected;
  }

  private async generateReportContent(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMatrix: any,
    topReferences: any[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<any> {
    const reportData = {
      idea_id: searchRun.id,
      report: {
        executive_summary: `Novelty assessment completed with ${aggregationResult.decision} determination (score: ${aggregationResult.novelty_score.toFixed(2)}, confidence: ${aggregationResult.confidence}).`,
        metrics: {
          novelty_score: aggregationResult.novelty_score,
          decision: aggregationResult.decision,
          confidence: aggregationResult.confidence
        },
        feature_matrix: featureMatrix,
        top_references: topReferences,
        final_remarks: `Analysis based on title/abstract review of ${aggregationResult.per_patent_coverage.length} references.`,
        appendices: {
          prior_art_metadata: [], // Would populate from PQAI data
          methodology: `Feature mapping used Present/Partial/Absent assessment with ${config.stage35a.batchSize} patents per batch.`,
          quality_flags: aggregationResult.integration_check
        }
      }
    };

    return reportData;
  }

  private buildReportProsePrompt(searchRun: any, aggregationResult: AggregationResult, reportData: any): string {
    return `Generate a brief executive summary and final remarks for this novelty assessment report.

INPUT DATA:
- Decision: ${aggregationResult.decision}
- Novelty Score: ${aggregationResult.novelty_score}
- Confidence: ${aggregationResult.confidence}
- Risk Factors: ${aggregationResult.risk_factors.join(', ')}
- Integration Check: ${aggregationResult.integration_check.any_single_patent_covers_majority ?
    `Patent ${aggregationResult.integration_check.integration_pn} covers majority` :
    aggregationResult.integration_check.explanation}

OUTPUT JSON:
{
  "executive_summary": "2-3 sentence summary of findings",
  "final_remarks": "1-2 sentence conclusion",
  "recommendations": {
    "prosecution_strategy": ["2-3 key recommendations"],
    "next_steps": ["1-2 immediate actions"]
  }
}`;
  }

  // Stage 3.5b Helper Methods

  private computePerPatentCoverage(featureMaps: PatentFeatureMap[], inventionFeatures: string[]): PerPatentCoverage[] {
    return featureMaps.map(patentMap => {
      const cells = patentMap.feature_analysis;
      const presentCount = cells.filter(c => c.status === 'Present').length;
      const partialCount = cells.filter(c => c.status === 'Partial').length;
      const absentCount = cells.filter(c => c.status === 'Absent' || c.status === 'Unknown').length;
      const coverageRatio = inventionFeatures.length > 0 ? presentCount / inventionFeatures.length : 0;

      return {
        pn: patentMap.pn,
        present_count: presentCount,
        partial_count: partialCount,
        absent_count: absentCount,
        coverage_ratio: Math.round(coverageRatio * 100) / 100
      };
    });
  }

  private computePerFeatureUniqueness(featureMaps: PatentFeatureMap[], inventionFeatures: string[]): PerFeatureUniqueness[] {
    return inventionFeatures.map(feature => {
      const totalPatents = featureMaps.length;
      const presentIn = featureMaps.filter(p => p.feature_analysis.find(c => c.feature === feature)?.status === 'Present').length;
      const partialIn = featureMaps.filter(p => p.feature_analysis.find(c => c.feature === feature)?.status === 'Partial').length;
      const absentIn = totalPatents - presentIn - partialIn;

      const uniqueness = totalPatents > 0 ? 1 - (presentIn / totalPatents) : 1;

      return {
        feature,
        present_in: presentIn,
        partial_in: partialIn,
        absent_in: absentIn,
        uniqueness: Math.round(uniqueness * 100) / 100
      };
    });
  }

  private performIntegrationCheck(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    criticalFeatures: string[]
  ): IntegrationCheck {
    const majorityThreshold = Math.ceil(inventionFeatures.length * 0.8);

    for (const patentMap of featureMaps) {
      const presentFeatures = patentMap.feature_analysis.filter(c => c.status === 'Present').length;

      if (presentFeatures >= majorityThreshold) {
        // Check if it mentions same use-case intent
        const hasUseCaseLanguage = this.checkUseCaseIntent(patentMap, inventionFeatures);
        if (hasUseCaseLanguage) {
          return {
            any_single_patent_covers_majority: true,
            integration_pn: patentMap.pn,
            explanation: `Patent ${patentMap.pn} covers ${presentFeatures}/${inventionFeatures.length} features with matching use-case language`
          };
        }
      }
    }

    return {
      any_single_patent_covers_majority: false,
      explanation: 'No single patent covers a majority of features with consistent use-case language'
    };
  }

  private checkUseCaseIntent(patentMap: PatentFeatureMap, inventionFeatures: string[]): boolean {
    // Simple heuristic: check if patent title/abstract contains words that suggest same application context
    // This is a simplified version - in practice might use more sophisticated NLP
    const patentText = `${patentMap.title} ${patentMap.feature_analysis.map(c => c.evidence).join(' ')}`.toLowerCase();

    // Look for common use-case words that suggest same technical field
    const useCaseWords = ['system', 'method', 'apparatus', 'device', 'process', 'using', 'for', 'to'];

    return useCaseWords.some(word => patentText.includes(word));
  }

  private computeNoveltyScore(perFeatureUniqueness: PerFeatureUniqueness[], criticalFeatures: string[]): number {
    // New definition (column-wise / feature-wise):
    // - Treat each feature as a fixed-weight slice of novelty.
    // - If a feature appears as Present in any prior-art patent, its novelty contribution is 0.
    // - If it appears only as Partial (and never Present), it keeps 50% of its novelty weight.
    // - Only features with no Present or Partial hits across all patents contribute with 100% of their weight.
    //
    // Critical features (if configured) are given double weight, but still follow the same all-or-nothing rule.

    if (!Array.isArray(perFeatureUniqueness) || perFeatureUniqueness.length === 0) {
      return 1;
    }

    let totalWeight = 0;
    let novelWeight = 0;

    for (const u of perFeatureUniqueness) {
      const isCritical = criticalFeatures.includes(u.feature);
      const weight = isCritical ? 2 : 1;
      totalWeight += weight;

      let noveltyFactor = 1;
      if (u.present_in > 0) {
        // Any Present evidence kills novelty for this feature
        noveltyFactor = 0;
      } else if (u.partial_in > 0) {
        // Only Partial evidence: retain 50% novelty
        noveltyFactor = 0.5;
      } else {
        // No Present or Partial evidence: fully novel
        noveltyFactor = 1;
      }

      novelWeight += weight * noveltyFactor;
    }

    if (totalWeight === 0) return 1;

    const noveltyScore = novelWeight / totalWeight;
    return Math.round(noveltyScore * 100) / 100;
  }

  private computeDecisionAndConfidence(
    noveltyScore: number,
    integrationCheck: IntegrationCheck,
    perFeatureUniqueness: PerFeatureUniqueness[],
    patentsAnalyzed: number,
    qualityFlags: any,
    criticalFeatures: string[]
  ): { decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence'; confidence: 'High' | 'Medium' | 'Low' } {

    // Low Evidence takes precedence
    if (qualityFlags.low_evidence || patentsAnalyzed < 5) {
      return { decision: 'Low Evidence', confidence: 'Low' };
    }

    let decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';

    if (integrationCheck.any_single_patent_covers_majority) {
      // Integration passes - check if coverage is dense
      const denseCoverage = this.checkDenseCoverage(perFeatureUniqueness);
      decision = denseCoverage ? 'Not Novel' : 'Partially Novel';
    } else {
      // Integration fails - check for high uniqueness on critical features
      const hasHighUniquenessCritical = criticalFeatures.some(feature => {
        const uniqueness = perFeatureUniqueness.find(u => u.feature === feature)?.uniqueness || 0;
        return uniqueness >= 0.7;
      });

      const hasAnyHighUniqueness = perFeatureUniqueness.some(u => u.uniqueness >= 0.6);

      if (hasHighUniquenessCritical) {
        decision = 'Novel';
      } else if (hasAnyHighUniqueness) {
        decision = 'Partially Novel';
      } else {
        decision = 'Not Novel';
      }
    }

    // Compute confidence
    let confidence: 'High' | 'Medium' | 'Low' = 'Medium';

    if (patentsAnalyzed >= 20 && perFeatureUniqueness.filter(u => u.partial_in > 0).length <= patentsAnalyzed * 0.1) {
      confidence = 'High';
    } else if (qualityFlags.ambiguous_abstracts || qualityFlags.language_mismatch) {
      confidence = 'Low';
    }

    return { decision, confidence };
  }

  private checkDenseCoverage(perFeatureUniqueness: PerFeatureUniqueness[]): boolean {
    // Dense coverage: â‰¥70% of features have present count â‰¥40% of patents
    const totalFeatures = perFeatureUniqueness.length;
    const denseFeatures = perFeatureUniqueness.filter(u =>
      (u.present_in / (u.present_in + u.partial_in + u.absent_in)) >= 0.4
    ).length;

    return (denseFeatures / totalFeatures) >= 0.7;
  }

  private identifyRiskFactors(
    featureMaps: PatentFeatureMap[],
    perFeatureUniqueness: PerFeatureUniqueness[],
    qualityFlags: any,
    inventionFeatures: string[]
  ): string[] {
    const risks: string[] = [];

    // Keyword echo risk
    const highKeywordEcho = perFeatureUniqueness.filter(u => u.uniqueness < 0.3).length > inventionFeatures.length * 0.5;
    if (highKeywordEcho) {
      risks.push('High keyword echo risk in multiple references');
    }

    // Generic features
    const genericFeatures = perFeatureUniqueness.filter(u => u.present_in > featureMaps.length * 0.8).length;
    if (genericFeatures > 0) {
      risks.push(`${genericFeatures} features are generic phrasing`);
    }

    // Quality flags
    if (qualityFlags.ambiguous_abstracts) {
      risks.push('Many references have ambiguous or short abstracts');
    }

    if (qualityFlags.language_mismatch) {
      risks.push('Multiple references appear to be in non-English languages');
    }

    // Domain saturation
    const lowUniquenessFeatures = perFeatureUniqueness.filter(u => u.uniqueness < 0.2).length;
    if (lowUniquenessFeatures > inventionFeatures.length * 0.3) {
      risks.push('Domain appears saturated with similar technology');
    }

    return risks;
  }

  private async storeAggregationSnapshot(
    searchId: string,
    aggregationResult: AggregationResult,
    stats: any,
    qualityFlags: any
  ): Promise<void> {
    await (prisma as any).aggregationSnapshot.upsert({
      where: { searchId },
      update: {
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
        updatedAt: new Date()
      },
      create: {
        searchId,
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
      }
    });
  }


  private async performStage4(
    searchRun: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: any; reportUrl?: string; error?: string }> {
    try {
      console.log('ðŸ“„ Starting Stage 4: Report Generation');

      // Validate required data for Stage 4 report generation
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      if (!stage0Data || !stage0Data.inventionFeatures || stage0Data.inventionFeatures.length === 0) {
        return {
          success: false,
          error: 'Stage 0 results are required for report generation. Please ensure Stage 0 is completed.'
        };
      }

      const stage1Data = searchRun.stage1Results as unknown as any;
      if (!stage1Data || !Array.isArray(stage1Data.pqaiResults) || stage1Data.pqaiResults.length === 0) {
        return {
          success: false,
          error: 'Stage 1 results are required for report generation. Please ensure Stage 1 is completed.'
        };
      }

      let aggregationResult = searchRun.stage4Results as unknown as AggregationResult | null;
      const featureMapData = searchRun.stage35Results as unknown as FeatureMapBatchResult | null;
      if (!featureMapData && !aggregationResult) {
        return {
          success: false,
          error: 'Stage 3.5 results are required for report generation. Please ensure Stage 3.5a is completed.'
        };
      }

      // If aggregation was not persisted earlier (no stage4Results), compute it now from 3.5a data
      if (!aggregationResult && featureMapData) {
        const agg = await this.performStage35b(searchRun.id, stage0Data, featureMapData, config, requestHeaders);
        if (!agg.success || !agg.data) {
          return { success: false, error: agg.error || 'Failed to aggregate feature mapping for report' };
        }
        aggregationResult = agg.data;
      }

      if (!aggregationResult) {
        return { success: false, error: 'Aggregation data missing. Please re-run Stage 3.5a.' };
      }

      const aggRes = aggregationResult as AggregationResult;

      // Get feature map cells from database (including any overrides)
      const featureMapCells = await this.getFeatureMapCellsWithOverrides(searchRun.id);

      // Select top patents for detailed analysis, filtered to those with â‰¥1 matching feature
      const selectedPatents = this.selectPatentsByGreedyCoverage(
        aggRes.per_patent_coverage,
        featureMapCells,
        stage0Data.inventionFeatures || [],
        Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : undefined
      );

      console.log(`ðŸ“Š Generating report with ${aggRes.decision} decision, score ${aggRes.novelty_score}`);

      // Build the feature-patent matrix for the report
      const featureMatrix = this.buildFeaturePatentMatrix(
        stage0Data.inventionFeatures || [],
        featureMapCells,
        config.stage4.maxRefsForReportMain
      );

      // Get top references sorted by coverage ratio
      const topReferences = this.getTopReferences(
        aggRes.per_patent_coverage,
        config.stage4.maxRefsForReportMain
      );

      // Prepare report inputs
      const reportInputs = this.prepareReportInputs(
        searchRun,
        stage0Data,
        aggRes,
        featureMapCells,
        config
      );

      // Prepare enhanced report inputs with selected patents
      const selectedPatentsSummary = selectedPatents.map(p => {
        const present = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Present').length : 0;
        const partial = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Partial').length : 0;
        return {
          patent_number: p.patentNumber,
          coverage_ratio: p.coverageRatio,
          avg_feature_overlap: Number((p.avgFeatureOverlap || 0).toFixed(3)),
          pqai_relevance: p.pqaiRelevance || 0,
          present_count: present,
          partial_count: partial
        };
      });

      const enhancedReportInputs = {
        invention_features: stage0Data.inventionFeatures || [],
        selected_patents: selectedPatentsSummary,
        search_metadata: {
          search_id: searchRun.id,
          search_date: searchRun.createdAt,
          jurisdiction: config.jurisdiction,
          total_patents_found: aggregationResult.per_patent_coverage.length,
          selected_patents_count: selectedPatents.length,
          // Added context to expand the Stage 4 summary
          pqai_initial_count: Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults.length : undefined,
          ai_relevance_accepted: Array.isArray(stage1Data?.aiRelevance?.accepted) ? stage1Data.aiRelevance.accepted.length : undefined,
          ai_relevance_borderline: Array.isArray(stage1Data?.aiRelevance?.borderline) ? stage1Data.aiRelevance.borderline.length : undefined
        },
        patent_details: selectedPatents.map(patent => ({
          patent_number: patent.patentNumber,
          title: patent.title || 'Untitled Patent',
          link: patent.link || `https://patents.google.com/patent/${patent.patentNumber}`,
          coverage_ratio: patent.coverageRatio,
          avg_feature_overlap: patent.avgFeatureOverlap,
          pqai_relevance: patent.pqaiRelevance || 0,
          abstract: ('' + (patent.abstract || '')).substring(0, 1800),
          mappings: patent.mappings
        })),
        feature_analysis_matrix: selectedPatents.map(patent => ({
          patent: patent.patentNumber,
          ...Object.fromEntries(
            (stage0Data.inventionFeatures || []).map((feature, index) => [
              `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0
            ])
          )
        })),
        structured_narrative: aggRes.structured_narrative || {}
      };

      // Execute LLM call for enhanced analytical report generation using attorney-style V3 prompt
      let basePrompt = STAGE4_REPORT_PROMPT_V3
        .replace('{invention_features}', JSON.stringify(enhancedReportInputs.invention_features))
        .replace('{selected_patents}', JSON.stringify(enhancedReportInputs.selected_patents))
        .replace('{search_metadata}', JSON.stringify(enhancedReportInputs.search_metadata))
        .replace('{feature_analysis_matrix}', JSON.stringify(enhancedReportInputs.feature_analysis_matrix))
        .replace('{structured_narrative}', JSON.stringify(enhancedReportInputs.structured_narrative))
        .replace(/SEARCH_ID/g, enhancedReportInputs.search_metadata.search_id)
        .replace(/GENERATION_DATE/g, new Date().toISOString().split('T')[0])
        .replace(/TOTAL_COUNT/g, enhancedReportInputs.search_metadata.total_patents_found.toString())
        .replace(/SELECTED_COUNT/g, enhancedReportInputs.search_metadata.selected_patents_count.toString())
        .replace(/SEARCH_DATE/g, enhancedReportInputs.search_metadata.search_date)
        .replace(/SEARCH_JURISDICTION/g, enhancedReportInputs.search_metadata.jurisdiction);

      // Provide abstracts/evidence for selected patents as additional context (do not echo back)
      basePrompt += "\n\nSupporting context (do not restate): PATENT_DETAILS_JSON=" + JSON.stringify(enhancedReportInputs.patent_details);

      // Expand summary to describe the full pipeline and selection logic for user confidence
      basePrompt += "\n\nOUTPUT CONTENT REQUIREMENTS:";
      basePrompt += "\n- In executive_summary.summary, state: initial PQAI results (search_metadata.pqai_initial_count); accepted and borderline counts from AI Relevance (if present); final selected_patents_count; and the selection logic (greedy feature coverage).";
      basePrompt += "\n- Under concluding_remarks, keep key_strengths/risks/recommendations and also include:";
      basePrompt += "\n  â€¢ 'advisory' field: Do NOT give legal conclusions; advise deep analysis of selected patents and next steps.";
      basePrompt += "\n  â€¢ 'patent_numbers' array listing the selected patent_number values for user review.";
      basePrompt += "\n- Add 'per_patent_analysis' array with detailed entries per selected/relevant patent using this format:";
      basePrompt += "\n  {";
      basePrompt += "\n    pn: patent_number,";
      basePrompt += "\n    title: patent_title,";
      basePrompt += "\n    relevance: 0.0-1.0 score (how relevant to our invention),";
      basePrompt += "\n    novelty_threat: 'anticipates' (discloses ALL elements) | 'obvious' (combining would render obvious) | 'adjacent' (related but doesn't threaten scope) | 'remote' (different field),";
      basePrompt += "\n    summary: 1-2 sentence explanation of relationship to our invention,";
      basePrompt += "\n    detailedAnalysis: {";
      basePrompt += "\n      summary: brief overview,";
      basePrompt += "\n      relevant_parts: [specific overlapping elements/claims],";
      basePrompt += "\n      irrelevant_parts: [elements that don't overlap with our claims],";
      basePrompt += "\n      novelty_comparison: what makes our invention novel vs this patent";
      basePrompt += "\n    }";
      basePrompt += "\n  }";
      basePrompt += "\n  Only include patents with relevance >= 0.3 (filter out remote/irrelevant ones).";

      // Enforce a critical, examiner-style stance and explicit decision policy
      basePrompt += "\n\nCRITICAL STANCE AND DECISION RULES:";
      basePrompt += "\n- You are an objective, skeptical examiner. Do not justify the idea; challenge it.";
      basePrompt += "\n- Be evidence-driven; avoid advocacy language and generic fluff.";
      basePrompt += "\n- Treat unknown/insufficient-evidence cells as weaknesses that lower confidence.";
      basePrompt += "\n- Decision policy: If any single patent covers \u2265 60% of features AND all critical features, default to 'Not Novel' unless a concrete, technical differentiator is clearly evidenced.";
      basePrompt += "\n- If features are scattered across multiple patents without integration, state this plainly; do not imply novelty unless integration is truly absent in prior art.";

      // Request new patent ideas for the Idea Bank using the same creative brief used in drafting's AI relevance review
      const __ideaGenRefs = (enhancedReportInputs.patent_details || [])
        .map((p: any) => `PN: ${p.patent_number}\nTitle: ${p.title}\nAbstract: ${String(p.abstract||'').slice(0,400)}`)
        .join('\n\n');

      basePrompt += `\n\nIDEA GENERATION (for idea_bank_suggestions):\n`;
      basePrompt += `You are a dual-headed entity:\n`;
      basePrompt += `- Left brain: ruthless patent examiner who kills any idea that is obvious under 35 U.S.C. §103 or abstract under §101.\n`;
      basePrompt += `- Right brain: visionary CTO who invents only “white-space” solutions that make the cited references obsolete.\n`;
      basePrompt += `Both brains must co-sign every concept or it is rejected.\n`;

      basePrompt += `\nINVENTION CONTEXT:\nTitle: ${String(searchRun.title || '')}\nSearch Query: ${String((stage0Data as any)?.searchQuery || '')}\n`;
      
      basePrompt += `\nCORE OBJECTIVE:\n`;
      basePrompt += `The user is looking for "White Space" inventions—areas where no patent currently exists.\n`;
      basePrompt += `Do not just improve the references. Make them obsolete.\n`;
      basePrompt += `Think from First Principles: What is the fundamental physics/logic limit here, and how do we bypass it?\n`;

      basePrompt += `\nINVENTION BRIEFING:\n`;
      basePrompt += `Generate exactly 5 patent-grade concepts that:\n`;
      basePrompt += `1. Are **orthogonal** to every mechanism disclosed in REFERENCES.\n`;
      basePrompt += `2. Contain at least one **physical structure** or **chemical composition** (no pure algorithms, no “AI to optimize”).\n`;
      basePrompt += `3. Can be **enabled** by a PHOSITA with only routine experimentation (no perpetual motion, no room-temperature superconductors unless you supply the formula).\n`;
      basePrompt += `4. Pass the **“cold shower” test**: if you woke up tomorrow and read the claim on the front page of TechCrunch, you would think “wow, that’s clever—and nobody did that before.”\n`;

      basePrompt += `\nCREATIVITY FILTERS (apply ≥1 per idea):\n`;
      basePrompt += `A. **Anti-Solution**: Invert the primary physical state (e.g., if it's rigid, make it fluid; if it's centralized, make it swarm-based).\n`;
      basePrompt += `B. **Resource Starvation**: Design for zero electricity, zero RF bandwidth, or zero rare-earth materials.\n`;
      basePrompt += `C. **Biomimicry**: Copy a biological mechanism that has **no** existing engineering analog in the field.\n`;
      basePrompt += `D. **Dimensional Shift**: Replace spatial hardware with temporal encoding, or vice-versa.\n`;
      basePrompt += `E. **Cross-Pollination**: Import a physical phenomenon from an unrelated domain (e.g., high-frequency trading latency-arbitrage → ultrasonic acoustic arbitrage in concrete sensing).\n`;

      basePrompt += `\nOUTPUT SCHEMA (embed inside the overall JSON under key 'idea_bank_suggestions'):\n`;
      basePrompt += `Array of 3-5 objects with fields:\n`;
      basePrompt += `{\n`;
      basePrompt += `  "title": "≤12 words, technical, no fluff",\n`;
      basePrompt += `  "core_principle": "One sentence problem statement anchored in white space, followed by: Unlike standard approaches that use X, this embodiment uses Y (2-3 sentences, physical detail)",\n`;
      basePrompt += `  "expected_advantage": "Concrete commercial scenario with $-size if possible",\n`;
      basePrompt += `  "tags": ["technical-domain", "application", "disruption-type", "cross-discipline"],\n`;
      basePrompt += `  "non_obvious_extension": "Exact sentence from REFERENCES that this idea avoids (Cross-ref Killshot)"\n`;
      basePrompt += `}\n`;

      basePrompt += `\nREFERENCE SNAPSHOTS (Analyze these to find what to AVOID or DISRUPT):\n${__ideaGenRefs}`;

      // If no intersecting patents, add explicit instruction for the report
      if (!selectedPatents || selectedPatents.length === 0) {
        basePrompt += `\n\nNOTE_TO_MODEL: No prior art with intersecting features (Present/Partial) was found in Stage 3.5. Generate the report focusing on Stage 0 features, uniqueness rationale, and explain that no overlapping evidence was identified.`;
      }

      // If Stage 3.5c (or 3.5a/3.5b) produced per-patent remarks, replace prompt with lightweight remarks-based prompt
      try {
        const stage4Any: any = aggregationResult as any;
        const perRemarks: any[] = Array.isArray(stage4Any?.per_patent_remarks) ? stage4Any.per_patent_remarks : [];
        if (perRemarks.length > 0) {
          const metrics = {
            novelty_score: aggRes.novelty_score,
            decision: aggRes.decision,
            confidence: aggRes.confidence
          } as any;
          basePrompt = STAGE4_REPORT_PROMPT_FROM_REMARKS_V2
            + "\ninvention_features=" + JSON.stringify(stage0Data.inventionFeatures || [])
            + "\nper_patent_remarks=" + JSON.stringify(perRemarks)
            + "\nsearch_metadata=" + JSON.stringify(enhancedReportInputs.search_metadata)
            + "\nmetrics=" + JSON.stringify(metrics);
        }
      } catch {}

      // Use admin-configured model via NOVELTY_REPORT_GENERATION stage
      console.log(` [Stage4] Attempting report generation with admin-configured model`);
      let llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        { taskCode: TaskCode.LLM6_REPORT_GENERATION, stageCode: 'NOVELTY_REPORT_GENERATION', prompt: basePrompt }
      );

      // The gateway handles fallbacks via admin configuration, but log if first attempt fails
      if (!llmResult.success || !llmResult.response) {
        console.warn(`[Stage4] Report generation failed: ${llmResult.error?.message || 'Unknown error'}`);
      }

      if (!llmResult.success || !llmResult.response) {
        console.warn('LLM report generation failed, using fallback structure');
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggregationResult, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Parse the modern report structure (robust to truncation/non-JSON wrappers)
      let reportData: any;
      try {
        reportData = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn('LLM report JSON parse failed, falling back to deterministic report:', parseError);
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggRes, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Domain validation: if LLM content appears off-topic vs Stage 0, drop LLM prose and use deterministic
      if (!this.validateReportDomain(stage0Data, reportData)) {
        console.warn('âš ï¸ LLM report appears off-topic. Using deterministic report content.');
        reportData = {};
      }

      // Enhance with deterministic data
      // Normalize and extract idea bank suggestions if present
      const extractIdeas = (data: any): Array<any> => {
        const raw = data?.idea_bank_suggestions || data?.new_ideas || data?.ideas || [];
        if (!Array.isArray(raw)) return [];
        return raw.map((ib: any) => ({
          title: String(ib.title || ib.ideaTitle || '').slice(0, 200),
          core_principle: String(ib.core_principle || ib.corePrinciple || '').slice(0, 2000),
          expected_advantage: String(ib.expected_advantage || '').slice(0, 500),
          tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
          non_obvious_extension: String(ib.non_obvious_extension || '').slice(0, 1000)
        })).filter((x: any) => x.title);
      };
      // Extract ideas from report (fallback if dedicated call fails)
      const reportIdeas = extractIdeas(reportData);

      // === DEDICATED IDEA BANK GENERATION ===
      // Use IDEA_BANK_GENERATION stage for unified management with drafting pipeline
      // This allows admins to configure idea generation model from one place
      let ideaBank = reportIdeas; // Default to ideas from report
      
      try {
        console.log('[Stage4] Generating ideas via dedicated IDEA_BANK_GENERATION stage...');
        const ideaGenResult = await this.generateIdeaBankSuggestions(
          searchRun,
          stage0Data,
          enhancedReportInputs.patent_details || [],
          requestHeaders
        );
        
        if (ideaGenResult && ideaGenResult.length > 0) {
          console.log(`[Stage4] Dedicated idea generation produced ${ideaGenResult.length} ideas`);
          ideaBank = ideaGenResult;
        } else if (reportIdeas.length > 0) {
          console.log(`[Stage4] Using ${reportIdeas.length} ideas from report (fallback)`);
        }
      } catch (ideaGenError) {
        console.warn('[Stage4] Dedicated idea generation failed, using report ideas:', ideaGenError);
        // Fall back to ideas extracted from report
      }

      const finalReportData = {
        ...this.enhanceReportWithDeterministicData(reportData, aggRes, reportInputs),
        idea_bank_suggestions: ideaBank
      };

      // === TRIGGER UNIFIED IDEA BANK FUNNEL ASYNCHRONOUSLY ===
      // Old synchronous persistence removed - now using unified funnel with:
      // - Stream A: Cross-Domain Applications
      // - Stream B: Technology Combinations  
      // - Stream C: LLM Validation Layer (approves/rejects before persistence)
      if (searchRun.userId && aggRes.per_patent_coverage?.length > 0) {
        // Build prior art analysis in unified format for the funnel
        const priorArtForFunnel: PriorArtAnalysisItem[] = (enhancedReportInputs.patent_details || []).map((p: any, idx: number) => {
          const coverage = aggRes.per_patent_coverage?.[idx];
          const perPatentAnalysis = reportData?.concluding_remarks?.per_patent_analysis?.find(
            (a: any) => a.pn === p.patent_number || a.patent_number === p.patent_number
          );
          
          return {
            pn: p.patent_number || '',
            title: p.title || '',
            abstract: p.abstract || '',
            relevance: coverage?.coverage_ratio || 0.5,
            novelty_threat: perPatentAnalysis?.novelty_threat || 'adjacent',
            summary: perPatentAnalysis?.summary || '',
            detailedAnalysis: {
              summary: perPatentAnalysis?.detailedAnalysis?.summary || '',
              relevant_parts: perPatentAnalysis?.detailedAnalysis?.relevant_parts || [],
              irrelevant_parts: perPatentAnalysis?.detailedAnalysis?.irrelevant_parts || [],
              novelty_comparison: perPatentAnalysis?.detailedAnalysis?.novelty_comparison || ''
            }
          } as PriorArtAnalysisItem;
        }).filter((p: PriorArtAnalysisItem) => p.pn && p.relevance >= 0.3);

        const funnelInput: IdeaFunnelInput = {
          source: 'novelty_search',
          invention: {
            title: searchRun.title || '',
            abstract: (stage0Data as any)?.abstract || '',
            features: stage0Data.inventionFeatures || [],
            searchQuery: stage0Data.searchQuery || ''
          },
          priorArtAnalysis: priorArtForFunnel,
          userId: searchRun.userId,
          searchRunId: searchRun.id,
          requestHeaders: requestHeaders || {}
        };

        console.log('[Stage4] Triggering Idea Bank Funnel asynchronously...');
        ideaBankFunnel.processIdeasAsync(funnelInput).catch(err => {
          console.error('[Stage4] Idea Bank Funnel failed:', err);
        });
      }

      // PDF export removed for novelty report path
      let reportUrl: string | undefined = undefined;

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId: searchRun.id,
          stage: NoveltySearchStage.STAGE_4,
          taskCode: TaskCode.LLM6_REPORT_GENERATION,
          prompt: this.buildReportProsePrompt(searchRun, aggregationResult, reportData),
          response: llmResult.response?.output,
          tokensUsed: llmResult.response?.outputTokens,
          modelClass: llmResult.response?.modelClass,
        },
      });

      console.log(' Stage 4 completed successfully');
      return { success: true, data: finalReportData, reportUrl };

    } catch (error) {
      console.error('Stage 4 error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 failed'
      };
    }
  }

  // === DEDICATED IDEA BANK GENERATION ===
  /**
   * Generate idea bank suggestions using the unified IDEA_BANK_GENERATION stage
   * This allows admins to configure the idea generation model from one place
   * Same model configuration is used by both drafting pipeline and novelty search
   */
  private async generateIdeaBankSuggestions(
    searchRun: any,
    stage0Data: NormalizedIdea,
    patentDetails: any[],
    requestHeaders?: Record<string, string>
  ): Promise<Array<{
    title: string;
    core_principle: string;
    expected_advantage: string;
    tags: string[];
    non_obvious_extension: string;
  }>> {
    const title = String(searchRun.title || '');
    const query = String((stage0Data as any)?.searchQuery || '');
    
    // Build reference snapshots for idea generation
    const candidatesText = patentDetails
      .slice(0, 10)
      .map((p: any) => `PN: ${p.patent_number}\nTitle: ${p.title}\nAbstract: ${String(p.abstract || '').slice(0, 400)}`)
      .join('\n\n');

    if (!candidatesText.trim()) {
      console.log('[IdeaBankGeneration] No patent references available, skipping idea generation');
      return [];
    }

    const ideaPrompt = `You are a dual-headed entity:
- Left brain: ruthless patent examiner who kills any idea that is obvious under 35 U.S.C. §103 or abstract under §101.
- Right brain: visionary CTO who invents only "white-space" solutions that make the cited references obsolete.

Both brains must co-sign every concept or it is rejected.

INVENTION CONTEXT:
Title: ${title}
Search Query: ${query}

CORE OBJECTIVE:
The user is looking for "White Space" inventions—areas where no patent currently exists.
Do not just improve the references. Make them obsolete.
Think from First Principles: What is the fundamental physics/logic limit here, and how do we bypass it?

INVENTION BRIEFING:
Generate exactly 5 patent-grade concepts that:
1. Are **orthogonal** to every mechanism disclosed in REFERENCES.
2. Contain at least one **physical structure** or **chemical composition** (no pure algorithms, no "AI to optimize").
3. Can be **enabled** by a PHOSITA with only routine experimentation (no perpetual motion, no room-temperature superconductors unless you supply the formula).
4. Pass the **"cold shower" test**: if you woke up tomorrow and read the claim on the front page of TechCrunch, you would think "wow, that's clever—and nobody did that before."

CREATIVITY FILTERS (apply ≥1 per idea):
A. **Anti-Solution**: Invert the primary physical state (e.g., if it's rigid, make it fluid; if it's centralized, make it swarm-based).
B. **Resource Starvation**: Design for zero electricity, zero RF bandwidth, or zero rare-earth materials.
C. **Biomimicry**: Copy a biological mechanism that has **no** existing engineering analog in the field.
D. **Dimensional Shift**: Replace spatial hardware with temporal encoding, or vice-versa.
E. **Cross-Pollination**: Import a physical phenomenon from an unrelated domain (e.g., high-frequency trading latency-arbitrage → ultrasonic acoustic arbitrage in concrete sensing).

OUTPUT SPECIFICATION:
Return ONLY valid JSON with exactly this schema.
{
  "idea_bank_suggestions": [
    {
      "title": "≤12 words, technical, no fluff",
      "core_principle": "One sentence problem statement anchored in white space, followed by: Unlike standard approaches that use X, this embodiment uses Y (2-3 sentences, physical detail)",
      "expected_advantage": "Concrete commercial scenario with $-size if possible",
      "tags": ["technical-domain", "application", "disruption-type", "cross-discipline"],
      "non_obvious_extension": "Exact sentence from REFERENCES that this idea avoids (Cross-ref Killshot)"
    }
  ]
}

GENERATE 5 RADICAL IDEAS.

REFERENCE SNAPSHOTS (Analyze these to find what to AVOID or DISRUPT):
${candidatesText}`;

    // Use dedicated IDEA_BANK_GENERATION stage - unified with drafting pipeline
    // Admin can configure this model from Super Admin LLM Config panel
    const ideaResult = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: TaskCode.LLM6_REPORT_GENERATION,  // Task code for metering
        stageCode: 'IDEA_BANK_GENERATION',          // Unified stage for idea generation
        prompt: ideaPrompt,
        idempotencyKey: crypto.randomUUID(),
        inputTokens: Math.ceil(ideaPrompt.length / 4),
        parameters: {
          maxOutputTokens: 5000,
          temperature: 0.9,  // High creativity for idea generation
          topP: 0.95
        },
        metadata: {
          searchRunId: searchRun.id,
          purpose: 'idea_bank_generation'
        }
      }
    );

    console.log('[IdeaBankGeneration] Model used:', ideaResult?.response?.modelClass || 'unknown');

    if (!ideaResult.success || !ideaResult.response) {
      console.warn('[IdeaBankGeneration] LLM call failed:', ideaResult.error?.message);
      return [];
    }

    try {
      const txt = (ideaResult.response.output || '').trim();
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      const json = start !== -1 && end !== -1 ? txt.substring(start, end + 1) : txt;
      const parsed = JSON.parse(json);
      const ideas = Array.isArray(parsed?.idea_bank_suggestions) ? parsed.idea_bank_suggestions : [];
      
      // Normalize and validate ideas
      return ideas.map((ib: any) => ({
        title: String(ib.title || '').slice(0, 200),
        core_principle: String(ib.core_principle || '').slice(0, 2000),
        expected_advantage: String(ib.expected_advantage || '').slice(0, 500),
        tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
        non_obvious_extension: String(ib.non_obvious_extension || '').slice(0, 1000)
      })).filter((x: any) => x.title);
    } catch (e) {
      console.warn('[IdeaBankGeneration] JSON parse failed:', e);
      return [];
    }
  }

  // Stage 3.5a Helper Methods
  /**
   * Validate that LLM report content is on-topic with Stage 0 invention
   */
  private validateReportDomain(stage0Data: NormalizedIdea, llmReport: any): boolean {
    try {
      const title = (stage0Data as any)?.title || '';
      const query = stage0Data?.searchQuery || '';
      const features: string[] = Array.isArray(stage0Data?.inventionFeatures) ? stage0Data.inventionFeatures : [];
      const topicTokens = (title + ' ' + query + ' ' + features.join(' ')).toLowerCase();

      // If no topic info, skip validation
      if (!topicTokens.trim()) return true;

      const text = JSON.stringify(llmReport || {}).toLowerCase();

      // Require at least two topic tokens to appear
      const topicHints = features.slice(0, 6).concat((query || '').split(/\s+/).slice(0, 6));
      const topicMatchCount = topicHints.filter(h => !!h && h.length > 3 && text.includes(h.toLowerCase())).length;

      // Flag common off-topic domains
      const offTopicKeywords = ['vehicle', 'autonomous vehicle', 'traffic', 'ride-share', 'road', 'fleet'];
      const offTopicHits = offTopicKeywords.filter(k => text.includes(k)).length;

      // Heuristic: if off-topic hits are high and topic matches are low => invalid
      if (offTopicHits >= 2 && topicMatchCount < 2) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  private normalizePatentsForFeatureMapping(pqaiResults: any[], maxRefsTotal: number): any[] {
    // Canonicalize PN (strip kind code), deduplicate, trim abstracts, drop entries without title/abstract
    const seen = new Set<string>();
    const normalized: any[] = [];

    for (const patent of pqaiResults.slice(0, maxRefsTotal)) {
      const pn = patent.publicationNumber || patent.publication_number || '';
      const canonicalPn = pn.replace(/[A-Z]\d*$/, ''); // Strip kind code for grouping

      if (!seen.has(canonicalPn) && patent.title && patent.abstract) {
        seen.add(canonicalPn);
        normalized.push({
          ...patent,
          canonicalPn,
          title: patent.title.substring(0, 200), // Truncate long titles
          abstract: patent.abstract.substring(0, 180) // Trim abstracts to ≤180 words
        });
      }
    }

    return normalized;
  }

  private normalizePatentsForFeatureMappingV2(pqaiResults: any[], maxRefsTotal: number): any[] {
    const seen = new Set<string>();
    const normalized: any[] = [];
    const take = Array.isArray(pqaiResults) ? pqaiResults.slice(0, maxRefsTotal) : [];

    for (const patent of take) {
      const pnAny = patent.publicationNumber || patent.publication_number || patent.pn || patent.id || '';
      const canonicalPn = String(pnAny).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '');
      if (!canonicalPn) continue;
      if (seen.has(canonicalPn)) continue;

      const titleStr = String(
        patent.title || (typeof patent.snippet === 'string' ? patent.snippet.split('.')[0] : '') || patent.publication_title || 'Untitled Patent'
      );

      let abstractRaw: any = (
        patent.abstract ||
        patent.snippet ||
        patent.description ||
        patent.abstract_text ||
        patent.abstractText ||
        patent.abstract_en ||
        patent.abstractEnglish ||
        ''
      );
      if (Array.isArray(abstractRaw)) abstractRaw = abstractRaw.join(' ');
      let abstractStr = String(abstractRaw || '').trim();
      if (!abstractStr) abstractStr = 'No abstract available.';

      const words = abstractStr.split(/\s+/).filter(Boolean);
      if (words.length > 180) abstractStr = words.slice(0, 180).join(' ');

      seen.add(canonicalPn);
      normalized.push({
        ...patent,
        canonicalPn,
        title: titleStr.substring(0, 200),
        abstract: abstractStr
      });
    }

    return normalized;
  }

  private createBatches(patents: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < patents.length; i += batchSize) {
      batches.push(patents.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processFeatureMappingBatch(
    searchId: string,
    batch: any[],
    inventionFeatures: string[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>,
    batchNumber: number = 0
  ): Promise<{ success: boolean; featureMaps?: PatentFeatureMap[]; error?: string }> {
    try {
      // Check cache first
      const batchHash = this.createBatchHash(batch, inventionFeatures);
      const ideaHash = this.createIdeaHash(inventionFeatures);
      const cached = await this.checkFeatureMappingCache(searchId, ideaHash, batchHash);

      if (cached) {
        console.log(`ðŸ’¾ Using cached results for batch ${batchNumber}`);
        return { success: true, featureMaps: cached };
      }

      // Format patent batch for prompt
      const patentBatchText = batch.map((patent, idx) => `
Patent ${idx + 1}:
PN: ${patent.canonicalPn}
Title: ${patent.title}
Abstract: ${patent.abstract}
---
      `).join('\n');

      // Build prompt
      const prompt = PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V2
        .replace('{invention_features}', JSON.stringify(inventionFeatures))
        .replace('{patent_batch}', patentBatchText);

      // Call LLM with admin-configured model via stage
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_FEATURE_ANALYSIS',
          prompt
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.warn(`LLM call failed for batch ${batchNumber}`);
        return { success: false, error: 'LLM call failed' };
      }

      // Parse and validate response
      let parsedResult: FeatureMapBatchResult;
      try {
        parsedResult = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn(`JSON parse failed for batch ${batchNumber}, attempting repair`);
        // Try one repair pass
        const repaired = this.repairFeatureMappingJSON(llmResult.response.output);
        if (repaired) {
          parsedResult = repaired;
        } else {
          // Mark cells as Unknown
          parsedResult = this.createUnknownFeatureMap(batch, inventionFeatures);
        }
      }

      // Validate and repair feature maps
      const validatedFeatureMaps = this.validateAndRepairFeatureMaps(parsedResult.feature_map, batch, inventionFeatures);

      // Cache the results
      await this.cacheFeatureMappingResults(searchId, ideaHash, batchHash, validatedFeatureMaps);

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId,
          stage: NoveltySearchStage.STAGE_3_5, // Will be renamed in enum later
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt,
          response: parsedResult as any,
          tokensUsed: llmResult.response.outputTokens,
          modelClass: llmResult.response.modelClass,
        },
      });

      return { success: true, featureMaps: validatedFeatureMaps };

    } catch (error) {
      console.error(`Batch ${batchNumber} processing error:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Batch processing failed' };
    }
  }

  private async storeFeatureMapResults(searchId: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    const cells: any[] = [];

    for (const patentMap of featureMaps) {
      for (const cell of patentMap.feature_analysis) {
        cells.push({
          searchId,
          publicationNumber: patentMap.pn,
          feature: cell.feature,
          status: cell.status,
          evidence: cell.evidence,
          confidence: 0.8 // Default confidence
        });
      }
    }

    // Bulk insert
    if (cells.length > 0) {
      await (prisma as any).featureMapCell.createMany({
        data: cells,
        skipDuplicates: true
      });
    }
  }

  private calculateQualityFlags(featureMaps: PatentFeatureMap[], originalPatents: any[]): { low_evidence: boolean; ambiguous_abstracts: boolean; language_mismatch: boolean } {
    const patentsAnalyzed = featureMaps.length;
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);
    const avgAbstractLength = patentsAnalyzed > 0 ? totalAbstractWords / patentsAnalyzed : 0;

    // Check for non-English abstracts (simple heuristic)
    const nonEnglishCount = originalPatents.filter(p =>
      /[^\x00-\x7F]/.test(p.abstract) || // Non-ASCII characters
      /^[^\w\s]*$/.test(p.abstract.replace(/\s/g, '')) // Very few word characters
    ).length;

    const languageMismatch = nonEnglishCount > originalPatents.length * 0.5;

    return {
      low_evidence: patentsAnalyzed < 5,
      ambiguous_abstracts: avgAbstractLength < 60,
      language_mismatch: languageMismatch
    };
  }

  private calculateFeatureMappingStats(featureMaps: PatentFeatureMap[], originalPatents: any[]): { patents_analyzed: number; avg_abstract_length_words: number } {
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);

    return {
      patents_analyzed: featureMaps.length,
      avg_abstract_length_words: featureMaps.length > 0 ? Math.round(totalAbstractWords / featureMaps.length) : 0
    };
  }

  private createBatchHash(batch: any[], inventionFeatures: string[]): string {
    const batchData = batch.map(p => `${p.canonicalPn}:${p.title}`).join('|');
    const featuresData = inventionFeatures.join('|');
    return crypto.createHash('md5').update(`${batchData}||${featuresData}`).digest('hex');
  }

  private createIdeaHash(inventionFeatures: string[]): string {
    return crypto.createHash('md5').update(inventionFeatures.join('|')).digest('hex');
  }

  private async checkFeatureMappingCache(searchId: string, ideaHash: string, batchHash: string): Promise<PatentFeatureMap[] | null> {
    try {
      const cacheEntry = await (prisma as any).featureMappingCache.findFirst({
        where: {
          ideaHash,
          batchHash,
          promptVersion: 'v1.0',
          expiresAt: {
            gt: new Date() // Not expired
          }
        }
      });

      if (cacheEntry) {
        console.log(`ðŸ’¾ Cache hit for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
        return cacheEntry.featureMaps as PatentFeatureMap[];
      }

      return null;
    } catch (error) {
      console.warn('Cache check failed:', error);
      return null;
    }
  }

  private async cacheFeatureMappingResults(searchId: string, ideaHash: string, batchHash: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    try {
      // Cache for 24 hours
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await (prisma as any).featureMappingCache.upsert({
        where: {
          ideaHash_batchHash_promptVersion: {
            ideaHash,
            batchHash,
            promptVersion: 'v1.1'
          }
        },
        update: {
          featureMaps: featureMaps as any,
          expiresAt
        },
        create: {
          ideaHash,
          batchHash,
          promptVersion: 'v1.1',
          featureMaps: featureMaps as any,
          expiresAt
        }
      });

      console.log(`ðŸ’¾ Cached results for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
    } catch (error) {
      console.warn('Cache storage failed:', error);
      // Don't fail the operation if caching fails
    }
  }

  private repairFeatureMappingJSON(responseText: string): FeatureMapBatchResult | null {
    try {
      // Simple repair: try to extract JSON from markdown or add missing brackets
      let repaired = responseText.trim();

      // Remove markdown code blocks
      repaired = repaired.replace(/^```json\s*/, '').replace(/\s*```$/, '');

      // Try to parse
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  private createUnknownFeatureMap(batch: any[], inventionFeatures: string[]): FeatureMapBatchResult {
    const featureMaps: PatentFeatureMap[] = batch.map(patent => ({
      pn: patent.canonicalPn,
      title: patent.title,
      feature_analysis: inventionFeatures.map(feature => ({
        feature,
        status: 'Unknown' as const,
        evidence: 'LLM parsing failed'
      }))
    }));

    return {
      feature_map: featureMaps,
      quality_flags: { low_evidence: true, ambiguous_abstracts: false, language_mismatch: false },
      stats: { patents_analyzed: batch.length, avg_abstract_length_words: 0 }
    };
  }

  private validateAndRepairFeatureMaps(featureMaps: PatentFeatureMap[], batch: any[], inventionFeatures: string[]): PatentFeatureMap[] {
    const validated: PatentFeatureMap[] = [];

    for (const patentMap of featureMaps) {
      // Find corresponding patent in batch
      const patent = batch.find(p => p.canonicalPn === patentMap.pn);
      if (!patent) continue;

      const validatedCells: FeatureMapCell[] = [];

      // Handle new format (separate present/partial/absent arrays)
      if (patentMap.present || patentMap.partial || patentMap.absent) {
        // Convert new format to old format for backward compatibility
        const allFeatures = [
          ...(patentMap.present || []).map(cell => ({ ...cell, status: 'Present' as const })),
          ...(patentMap.partial || []).map(cell => ({ ...cell, status: 'Partial' as const })),
          ...(patentMap.absent || []).map(cell => ({ ...cell, status: 'Absent' as const }))
        ];

        for (const feature of inventionFeatures) {
          const cell = allFeatures.find(c => c.feature === feature);
          if (cell) {
            const convertedCell: FeatureMapCell = {
              feature: cell.feature,
              status: cell.status,
              confidence: cell.confidence,
              quote: cell.quote,
              field: cell.field,
              reason: cell.reason
            };
            validatedCells.push(convertedCell);
          } else {
            // Create Unknown cell for missing features
            validatedCells.push({
              feature,
              status: 'Unknown',
              reason: 'Analysis not provided'
            });
          }
        }
      } else if (patentMap.feature_analysis) {
        // Handle old format (single feature_analysis array)
        for (const feature of inventionFeatures) {
          const cell = patentMap.feature_analysis.find(c => c.feature === feature);
          if (cell && ['Present', 'Partial', 'Absent'].includes(cell.status)) {
            validatedCells.push(cell);
          } else {
            // Create Unknown cell
            validatedCells.push({
              feature,
              status: 'Unknown',
              reason: 'Analysis not provided'
            });
          }
        }
      } else {
        // No valid data
        for (const feature of inventionFeatures) {
          validatedCells.push({
            feature,
            status: 'Unknown',
            reason: 'Invalid or missing analysis'
          });
        }
      }

      // Calculate coverage score if not provided
      let coverage = patentMap.coverage;
      if (!coverage && validatedCells.length > 0) {
        const present = validatedCells.filter(c => c.status === 'Present').length;
        const partial = validatedCells.filter(c => c.status === 'Partial').length;
        const absent = validatedCells.filter(c => c.status === 'Absent').length;
        const totalScore = validatedCells.reduce((sum, cell) => {
          if (cell.status === 'Present') return sum + 1.0;
          if (cell.status === 'Partial') return sum + 0.5;
          return sum;
        }, 0);
        const coverageScore = validatedCells.length > 0 ? totalScore / validatedCells.length : 0;

        coverage = { present, partial, absent, coverage_score: coverageScore };
      }

      validated.push({
        pn: patentMap.pn,
        title: patent.title,
        link: patentMap.link,
        coverage: coverage,
        present: patentMap.present,
        partial: patentMap.partial,
        absent: patentMap.absent,
        feature_analysis: validatedCells,
        remarks: (patentMap as any).remarks,
        model_decision: (patentMap as any).model_decision,
        decision: (patentMap as any).decision
      });
    }

    return validated;
  }

  // Helper methods

  private async searchPQAI(query: string, maxResults: number = 50): Promise<any[]> {
    // EXACT COPY from drafting stage 3.5 implementation
    const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || '90b423ac4fd243c790c068e3a9309cd7'
    if (!token) throw new Error('No PQAI API token configured. Set PQAI_API_TOKEN.')

    // PQAI endpoint: GET /search/102 with query parameters
    const baseUrl = 'https://api.projectpq.ai/search/102'

    // Simple normalization for PQAI (keep it compact as per Stage 1 design)
    let safeQuery = query
      .replace(/[\u2013\u2014]/g, '-')       // en/em dash → hyphen
      .replace(/[\u2018\u2019\u201C\u201D]/g, '"') // curly quotes → plain
      .replace(/[^\w\s-]/g, ' ')             // strip punctuation except hyphen
      .replace(/-/g, ' ')                      // turn hyphens into spaces to avoid tokenization issues
      .replace(/\s+/g, ' ')                   // collapse whitespace
      .trim()
    // Constrain to first 20 words (keep it compact per Stage 1 design and avoid PQAI server 500s)
    const words = safeQuery.split(/\s+/)
    if (words.length > 20) safeQuery = words.slice(0, 20).join(' ')

    const params = new URLSearchParams({
      q: safeQuery,
      n: String(Math.min(Math.max(10, maxResults), 50)),
      type: 'patent' // Only return patents, not research papers (NPL)
    })

    // Add token as query parameter for direct API
    params.set('token', token)

    const url = `${baseUrl}?${params.toString()}`

    // Debug: Log the final URL components
    console.log('PQAI Request Debug:', {
      baseUrl,
      queryLength: safeQuery.length,
      originalQueryLength: query.length,
      paramsCount: Array.from(params.entries()).length,
      hasToken: !!token,
      finalUrlLength: url.length,
      filters: 'type=patent' // Confirm patent-only filtering
    })

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    console.log('PQAI search:', {
      url: url.substring(0, 120) + '...',
      queryPreview: safeQuery.substring(0, 100) + '...',
      maxResults,
      hasToken: !!token,
      tokenLength: token.length
    })

    // Single API call per search with fetch + tighter headers and timeout
    let resp: Response | null = null
    try {
      const controller = new AbortController()
      const to = setTimeout(() => controller.abort(), 15000)

      // Configure fetch options to handle SSL certificate issues in development
      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store'
      }

      // In Node.js environment, we can configure HTTPS agent for self-signed certificates
      if (typeof window === 'undefined') {
        // Server-side: Use Node.js HTTPS agent to handle self-signed certificates
        const https = require('https')
        fetchOptions.agent = new https.Agent({
          rejectUnauthorized: false // Allow self-signed certificates for development
        })
      }

      resp = await fetch(url, fetchOptions)
      clearTimeout(to)
      console.log('PQAI search result:', { status: resp.status, url: url.substring(0, 120) + '...' })
    } catch (e) {
      console.log('PQAI search network error:', e)
      throw new Error(`Network error contacting PQAI API: ${String(e)}`)
    }

    if (!resp || !resp.ok) {
      let errorMsg = 'PQAI API request failed'
      let details: string | undefined

      if (resp) {
        errorMsg += ` (HTTP ${resp.status})`

        if (resp.status === 500) {
          errorMsg = 'PQAI API server error - the service may be temporarily unavailable'
        } else if (resp.status === 401 || resp.status === 403) {
          errorMsg = 'PQAI API authentication failed - please check your API token'
        } else if (resp.status === 429) {
          errorMsg = 'PQAI API rate limit exceeded - please try again later'
        }
        try {
          const errorText = await resp.text()
          details = errorText || undefined
          if (errorText.includes('Server error while handling request')) {
            errorMsg = 'PQAI API is currently experiencing server issues. Please try again later.'
          }
        } catch {}
      }

      console.log('PQAI API error:', { status: resp?.status, error: errorMsg, details })
      throw new Error(errorMsg)
    }

    let dataJson: any = {}
    try { dataJson = await resp.json() } catch (e) { console.log('Failed to parse JSON response:', e) }

    console.log('PQAI API full response:', JSON.stringify(dataJson, null, 2))

    // Try multiple possible result locations
    let results = []
    if (Array.isArray(dataJson?.results)) {
      results = dataJson.results
    } else if (Array.isArray(dataJson?.data)) {
      results = dataJson.data
    } else if (Array.isArray(dataJson)) {
      results = dataJson
    }

    console.log('PQAI API success - results count:', results.length, 'response keys:', Object.keys(dataJson))
    console.log('First result sample:', results[0] ? Object.keys(results[0]) : 'No results')
    if (results[0]) {
      console.log('First result data:', JSON.stringify(results[0], null, 2))
      console.log('Patent number fields in first result:', {
        pn: results[0].pn,
        patent_number: results[0].patent_number,
        publication_number: results[0].publication_number,
        publication_id: results[0].publication_id,
        publicationId: results[0].publicationId,
        patentId: results[0].patentId,
        patent_id: results[0].patent_id,
        id: results[0].id
      })
    }

    // Check for unique patent numbers
    const patentNumbers = results.map((r: any) => r.publication_number || r.patent_number || r.pn || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || 'N/A').filter((pn: any) => pn !== 'N/A')
    const uniquePatentNumbers = Array.from(new Set(patentNumbers))
    console.log('Patent numbers found:', patentNumbers.length, 'unique:', uniquePatentNumbers.length)
    if (patentNumbers.length !== uniquePatentNumbers.length) {
      console.log('WARNING: Duplicate patent numbers detected!')
    }

    // Normalize the results to a consistent format and extract actual relevance scores
    const normalizedResults = results.map((result: any) => {
      // Extract relevance score using the same pattern as drafting pipeline
      const relevanceScore = typeof result.score === 'number' ? result.score :
                            (typeof result.relevance === 'number' ? result.relevance : null)

      const publicationNumber = result.publication_number || result.patent_number || result.pn || result.id || 'Unknown';
      const link =
        result.link ||
        result.url ||
        result.patent_url ||
        result.google_patent_url ||
        `https://patents.google.com/patent/${publicationNumber}`;

      return {
        title: result.title || result.snippet?.split('.')[0] || 'Untitled Patent',
        publicationNumber,
        abstract: (result.snippet || result.abstract || result.description || result.abstract_text || result.abstractText || result.abstract_en || result.abstractEnglish || ''),
        year: result.year || result.filing_date?.substring(0, 4) || result.publication_date?.substring(0, 4) || null,
        inventors: Array.isArray(result.inventors) ? result.inventors : (result.inventors ? [result.inventors] : []),
        assignees: Array.isArray(result.assignees) ? result.assignees : (result.assignees ? [result.assignees] : []),
        cpcCodes: Array.isArray(result.cpc_codes) ? result.cpc_codes : [],
        ipcCodes: Array.isArray(result.ipc_codes) ? result.ipc_codes : [],
        relevanceScore: relevanceScore,
        rawScore: result.score || result.relevance, // Keep raw value for debugging
        link
      }
    })

    console.log('💾 Before sorting - first 5 relevance scores:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    // Sort by relevance score (highest first) - PQAI may not return perfectly sorted results
    normalizedResults.sort((a: any, b: any) => {
      const scoreA = a.relevanceScore || 0
      const scoreB = b.relevanceScore || 0
      return scoreB - scoreA // Higher scores first
    })

    console.log(' After sorting by relevance - top 5:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    return normalizedResults
  }

  private async getPatentDetails(publicationNumber: string): Promise<{
    title?: string;
    abstract?: string;
    claims?: string;
  }> {
    try {
      // Try to get from database first
      const patent = await prisma.priorArtPatent.findUnique({
        where: { publicationNumber },
        include: { details: true }
      });

      if (patent) {
        return {
          title: patent.title || undefined,
          abstract: patent.abstract || undefined,
          claims: patent.details?.claims as string || undefined
        };
      }

      // TODO: Fetch from PQAI or other patent databases
      return {};
    } catch (error) {
      console.error(`Failed to get patent details for ${publicationNumber}:`, error);
      return {};
    }
  }

  private async callLLMWithPreferredModel(
    prompt: string,
    preference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-pro',
    requestHeaders?: Record<string, string>
  ): Promise<LLMResult> {
    // Model and fallbacks are now configured via admin console (NOVELTY_REPORT_GENERATION stage)
    // The gateway handles model resolution and fallbacks automatically
    console.log(`🤖 Using admin-configured model via NOVELTY_REPORT_GENERATION stage`);

    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: TaskCode.LLM6_REPORT_GENERATION,
        stageCode: 'NOVELTY_REPORT_GENERATION',
        prompt
      }
    );

    return result;
  }
}



