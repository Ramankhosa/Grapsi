/**
 * Methodology-Specific Constraint Blocks
 * 
 * These are injected into section prompts based on the paper's methodologyType.
 * This keeps base prompts action-focused while adding methodology-specific guidance.
 * 
 * Usage in PaperSectionService:
 *   const constraints = getMethodologyConstraints(methodologyType, sectionKey);
 *   const fullPrompt = basePrompt + constraints + blueprintContext;
 */

export type MethodologyType = 
  | 'QUANTITATIVE' 
  | 'QUALITATIVE' 
  | 'MIXED_METHODS' 
  | 'REVIEW' 
  | 'THEORETICAL' 
  | 'CASE_STUDY';

export type SectionKey = 
  | 'literature_review' 
  | 'methodology' 
  | 'results' 
  | 'discussion' 
  | 'conclusion';

const methodologyConstraints: Record<MethodologyType, Partial<Record<SectionKey, string>>> = {
  QUANTITATIVE: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUANTITATIVE):
- Compare models, metrics, datasets, assumptions, and evaluation practices.
- Focus on statistical approaches, benchmark comparisons, and reproducibility.
- Identify methodological gaps in existing empirical work.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUANTITATIVE):
- Define independent, dependent, and control variables clearly.
- Describe datasets: source, size, sampling strategy, preprocessing, and train/test splits.
- Specify models/algorithms at a conceptual level (not code implementation).
- Define baselines and comparison conditions explicitly.
- State evaluation metrics and statistical tests to be used.
- Describe measures taken to reduce bias, overfitting, and data leakage.
- State threats to internal validity (confounds) and external validity (generalizability).`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUANTITATIVE):
- Report results aligned with the predefined metrics and baselines from Methodology.
- Present descriptive statistics before inferential statistics.
- State statistical tests used and report test outcomes precisely (p-values, confidence intervals).
- Report effect sizes where applicable.
- Include null or negative results if they were part of the evaluation plan.
- Do NOT interpret statistical meaning beyond reporting the values.`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUANTITATIVE):
- Discuss effect direction and consistency, not just magnitude.
- Address statistical significance and practical significance separately.
- Discuss robustness checks and sensitivity analyses cautiously.
- Explicitly state conditions under which findings may not hold.
- Address potential confounds and alternative explanations.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUANTITATIVE):
- Emphasize what the evidence supports and under what conditions.
- Avoid claims of universal generalization beyond the studied population/dataset.
- State confidence levels for key claims.`
  },

  QUALITATIVE: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUALITATIVE):
- Compare theoretical lenses, sampling strategies, analytic methods, and interpretive scope.
- Focus on conceptual frameworks and contextual factors in prior work.
- Identify gaps in understanding, context coverage, or theoretical development.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUALITATIVE):
- Describe research design (e.g., phenomenology, grounded theory, ethnography, case study).
- Specify participant selection: criteria, recruitment, sampling rationale, and saturation.
- Explain data collection procedures: interviews, observations, documents, artifacts.
- Describe instruments: interview guides, observation protocols, prompts.
- Describe analytic approach: coding process, theme development, constant comparison.
- State how trustworthiness was ensured:
  • Credibility (member checking, triangulation)
  • Transferability (thick description)
  • Dependability (audit trail)
  • Confirmability (reflexivity)
- Clarify researcher role, positionality, and reflexivity.`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUALITATIVE):
- Present findings as themes, patterns, categories, or narratives.
- Support each theme with representative evidence (direct quotes, observations).
- Use participant identifiers consistently (e.g., P1, P2).
- Avoid theorizing or explaining causes — that belongs to Discussion.
- Indicate prevalence or salience cautiously (e.g., "most participants", "a minority of").
- Keep analytic labels and codes consistent with those defined in Methodology.`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUALITATIVE):
- Interpret themes in relation to context, participants, and setting.
- Avoid claims of prevalence or frequency beyond the dataset.
- Address reflexivity: how researcher positionality may have influenced findings.
- Discuss transferability explicitly: what contexts might findings apply to?
- Connect findings to theoretical frameworks without overgeneralizing.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (QUALITATIVE):
- Emphasize contextual insights, meanings, and understandings gained.
- State transferability boundaries clearly.
- Avoid population-level or prevalence claims.
- Acknowledge the interpretive nature of findings.`
  },

  MIXED_METHODS: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (MIXED METHODS):
- Compare both quantitative and qualitative approaches in the literature.
- Identify how prior work has integrated or failed to integrate multiple methods.
- Justify why a mixed methods approach addresses gaps that single methods cannot.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (MIXED METHODS):
- Explicitly justify WHY mixed methods are required (not just preferred).
- State the mixed methods design type: sequential (explanatory/exploratory), concurrent, embedded.
- Describe the quantitative component completely (variables, sampling, analysis).
- Describe the qualitative component completely (design, participants, analysis).
- Explain the integration strategy:
  • When integration occurs (during data collection, analysis, or interpretation)
  • How findings from different methods inform each other
  • How conflicts between methods will be handled
- Address validity for both components AND integration validity.`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (MIXED METHODS):
- Report quantitative and qualitative results in separate subsections.
- Maintain clear boundaries between data types in reporting.
- Do NOT integrate interpretations in Results — save that for Discussion.
- Use clear labels (e.g., "Quantitative Findings", "Qualitative Findings").`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (MIXED METHODS):
- Integrate quantitative and qualitative findings explicitly.
- Highlight convergence: where both methods support the same conclusion.
- Address divergence: where methods conflict, and what that means.
- Discuss complementarity: what each method contributed uniquely.
- Do NOT privilege one method unless the design explicitly justifies it.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (MIXED METHODS):
- Emphasize integrative insight gained by combining methods.
- State what could not have been learned with a single method.
- Avoid privileging one method unless justified by the research design.`
  },

  REVIEW: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (REVIEW PAPER):
- Note: For review papers, this section IS the main analytical content.
- Define the synthesis framework, taxonomy, or classification logic explicitly.
- Establish the dimensions, categories, or themes for organizing reviewed work.
- Explain the analytical lens being applied to the literature.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (REVIEW PAPER):
- Describe the review type: narrative, scoping, systematic, meta-analysis, or hybrid.
- Define the search strategy:
  • Databases searched
  • Search terms and Boolean logic
  • Date range and language restrictions
- State inclusion and exclusion criteria clearly and justify them.
- Describe the screening process: titles, abstracts, full-text stages.
- State who conducted screening and how disagreements were resolved.
- Explain the synthesis approach: thematic, comparative, vote-counting, or quantitative.
- If NOT following formal protocols (e.g., PRISMA), explain why and what was done instead.
- Acknowledge limitations of the review process explicitly.`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (REVIEW PAPER):
- Report synthesis outcomes: counts, distributions, categorizations, trends.
- Present the landscape of reviewed work descriptively.
- Use tables or figures to summarize patterns.
- Do NOT argue implications or identify gaps here — that belongs to Discussion.`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (REVIEW PAPER):
- Interpret synthesis patterns, tensions, and gaps across the literature.
- Explain what the synthesis reveals that individual studies do not.
- Do NOT re-summarize individual studies — interpret the STRUCTURE of the field.
- Identify research agenda based on systematic gaps, not hunches.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (REVIEW PAPER):
- Emphasize synthesis contributions: what is now clearer about the field?
- State the review's scope limitations honestly.
- Avoid implying empirical validation — this is a review, not primary research.`
  },

  THEORETICAL: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (THEORETICAL):
- Compare existing conceptual models, theoretical frameworks, and assumptions.
- Focus on explanatory power, scope conditions, and conceptual clarity.
- Identify theoretical gaps: missing constructs, unexplained relationships, boundary issues.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (THEORETICAL):
- Describe the theoretical framework development approach:
  • Conceptual analysis, synthesis, extension, or novel construction
- Explain the reasoning strategy and logic of theory building.
- Define key constructs and their relationships precisely.
- State boundary conditions and assumptions explicitly.
- Explain how the theory was developed: literature synthesis, logical derivation, analogy.
- Note: Empirical validation is out of scope but should be acknowledged.`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (THEORETICAL):
- Present the theoretical framework, model, or conceptual contribution systematically.
- Define propositions, constructs, and relationships clearly.
- Use figures or diagrams to illustrate the theoretical model if helpful.
- Present the theory's logic in a structured, step-by-step manner.`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (THEORETICAL):
- Discuss theoretical contributions relative to existing frameworks.
- Address scope conditions: when and where does the theory apply?
- Acknowledge boundary assumptions and their implications.
- Identify empirical implications: what predictions does the theory make?
- Discuss how the theory could be tested or falsified.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (THEORETICAL):
- Emphasize conceptual contributions and theoretical advancement.
- Acknowledge that empirical validation is needed.
- State the theory's intended scope and boundaries.`
  },

  CASE_STUDY: {
    literature_review: `
METHODOLOGY-SPECIFIC REQUIREMENTS (CASE STUDY):
- Compare case study approaches, analytical frameworks, and theoretical lenses.
- Focus on how prior work has used cases to build or test theory.
- Identify what contexts, phenomena, or mechanisms remain understudied.`,
    
    methodology: `
METHODOLOGY-SPECIFIC REQUIREMENTS (CASE STUDY):
- Justify case selection: why this case? (critical, extreme, typical, revelatory)
- Describe the case context and boundaries clearly.
- Explain data sources: documents, interviews, observations, archival records.
- Describe data collection procedures and timeline.
- Explain the analytical approach: within-case analysis, pattern matching, process tracing.
- If multiple cases: explain cross-case comparison logic.
- Address validity considerations:
  • Construct validity (multiple sources of evidence)
  • Internal validity (for causal cases)
  • External validity (analytical, not statistical generalization)
  • Reliability (case study protocol, database)`,
    
    results: `
METHODOLOGY-SPECIFIC REQUIREMENTS (CASE STUDY):
- Present case findings systematically and richly.
- Provide thick description with supporting evidence.
- Organize by themes, chronology, or analytical categories.
- If multiple cases: present each case before cross-case analysis.
- Use quotes, documents, and observations as evidence.`,
    
    discussion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (CASE STUDY):
- Interpret findings in relation to case context and theoretical lens.
- Discuss analytical generalization: what does this case teach us?
- Address transferability: what other contexts might findings apply to?
- Identify boundary conditions: when would these findings NOT apply?
- Connect case insights to broader theory or practice.`,
    
    conclusion: `
METHODOLOGY-SPECIFIC REQUIREMENTS (CASE STUDY):
- Emphasize contextual insights and lessons learned.
- Acknowledge case-specific limitations.
- State implications for theory and practice.
- Suggest directions for future cases or empirical testing.`
  }
};

/**
 * Get methodology-specific constraints for a section
 * @param methodologyType The paper's methodology type (from blueprint)
 * @param sectionKey The section being generated
 * @returns Constraint block to append to the base prompt, or empty string if none
 */
export function getMethodologyConstraints(
  methodologyType: string | null | undefined,
  sectionKey: string
): string {
  if (!methodologyType) return '';
  
  const normalized = methodologyType.toUpperCase().replace(/-/g, '_') as MethodologyType;
  const constraints = methodologyConstraints[normalized];
  
  if (!constraints) return '';
  
  return constraints[sectionKey as SectionKey] || '';
}

/**
 * Get all available methodology types
 */
export function getMethodologyTypes(): MethodologyType[] {
  return Object.keys(methodologyConstraints) as MethodologyType[];
}

/**
 * Check if methodology type has constraints for a section
 */
export function hasMethodologyConstraints(
  methodologyType: string,
  sectionKey: string
): boolean {
  const normalized = methodologyType.toUpperCase().replace(/-/g, '_') as MethodologyType;
  const constraints = methodologyConstraints[normalized];
  return !!constraints?.[sectionKey as SectionKey];
}

export { methodologyConstraints };

