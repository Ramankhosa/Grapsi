/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║                         MASTER SEED SCRIPT                                 ║
 * ║           Multi-Country Patent Filing System Database Setup                ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 * 
 * This script seeds ALL country-specific data required for the patent drafting system:
 *   1. Superset Sections (17 universal patent sections)
 *   2. Country Names (28+ countries with continents)
 *   3. Country Section Mappings (which sections apply to each country)
 *   4. Country Section Prompts (top-up prompts for jurisdiction-specific drafting)
 *   5. Country Profiles (full country configuration from JSON files)
 *   6. Jurisdiction Styles (diagram, export, validation configs)
 * 
 * Usage:
 *   node Countries/MasterSeed.js                    # Seed all data (skip existing)
 *   node Countries/MasterSeed.js --force            # Overwrite existing data
 *   node Countries/MasterSeed.js --dry-run          # Preview without changes
 *   node Countries/MasterSeed.js --country=IN       # Seed specific country only
 *   node Countries/MasterSeed.js --skip-styles      # Skip jurisdiction styles
 * 
 * Prerequisites:
 *   1. Database migrations applied: npx prisma migrate deploy
 *   2. At least one user exists (run: node scripts/setup-full-hierarchy.js)
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// ============================================================================
// COMMAND LINE ARGUMENTS
// ============================================================================
const args = process.argv.slice(2);
const options = {
  force: args.includes('--force'),
  dryRun: args.includes('--dry-run'),
  skipStyles: args.includes('--skip-styles'),
  country: args.find(a => a.startsWith('--country='))?.split('=')[1]?.toUpperCase()
};

const COUNTRIES_DIR = __dirname;
const SYSTEM_USER_ID = 'system-seeder';

// ============================================================================
// SUPERSET SECTIONS DEFINITION
// ============================================================================
const SUPERSET_SECTIONS = [
  {
    sectionKey: 'title',
    aliases: [],
    displayOrder: 1,
    label: 'Title of the Invention',
    description: 'The title should be brief, descriptive, and indicative of the technical field.',
    isRequired: true,
    // Context injection flags - determines what data to inject into section prompts
    requiresPriorArt: false,      // Does not need prior art references
    requiresFigures: false,       // Does not need figure list
    requiresClaims: false,        // Does not need claims context
    requiresComponents: false,    // Does not need component/numeral list
    instruction: `**Role:** Formalities Officer (US/EP/PCT Compliance).

**Task:** Generate a strict, descriptive Title.

**Input Data:** {{ABSTRACT_OR_SUMMARY}}

**Drafting Logic (Chain-of-Thought):**

1. **Analyze Subject:** Is this a System, Method, Apparatus, or Composition?

2. **Identify Core Function:** What is the technical function (e.g., "compressing video"), not the result (e.g., "watching movies faster").

3. **Filter Profanity:** Check for and remove banned words: *Novel, Improved, Smart, Intelligent, New, Best*.

4. **Format:** Remove any starting articles ("A", "The").

**Output Constraint:** Maximum 15 words. Sentence case. No period at the end.`,
    constraints: ['Maximum 15 words', 'Sentence case', 'No period at the end', 'No banned words: Novel, Improved, Smart, Intelligent, New, Best', 'Remove starting articles (A, The)']
  },
  {
    sectionKey: 'preamble',
    aliases: [],
    displayOrder: 2,
    label: 'Preamble',
    description: 'Legal preamble for patent applications (used in some jurisdictions).',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate the formal Preamble for an international patent application.`,
    constraints: ['Format exactly as shown', 'Include all applicant and inventor details']
  },
  {
    sectionKey: 'fieldOfInvention',
    aliases: ['field_of_invention', 'technicalField', 'technical_field', 'field'],
    displayOrder: 3,
    label: 'Field of the Invention',
    description: 'A brief statement of the technical field to which the invention pertains.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Classification Engine (IPC/CPC Expert).

**Task:** Generate a concise Field of Invention statement.

**Drafting Logic:**
1. Identify the primary technical domain (e.g., "data processing," "chemical compositions").
2. Identify the secondary application area if applicable.
3. Structure: "The present invention relates to [primary field], and more particularly to [specific application/sub-field]."

**Output Constraint:** 1-3 sentences maximum. No claims or advantages.`,
    constraints: ['1-3 sentences maximum', 'Start with "The present invention relates to..."', 'No claims or advantages mentioned']
  },
  {
    sectionKey: 'background',
    aliases: ['backgroundOfInvention', 'background_of_invention', 'priorArt', 'prior_art', 'background_art'],
    displayOrder: 4,
    label: 'Background of the Invention',
    description: 'Description of the prior art and problems with existing solutions.',
    isRequired: true,
    requiresPriorArt: true,       // ✅ MUST reference prior art patents
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Prior Art Analyst and Technical Writer.

**Task:** Generate a Background section that establishes the need for the invention.

**Structure:**
1. **Technical Context** (1-2 paragraphs): Describe the general technical area.
2. **Prior Art Review** (2-3 paragraphs): Describe existing solutions and their limitations.
3. **Problem Statement** (1 paragraph): Clearly state the technical problem that needs solving.

**Guidelines:**
- Be objective; avoid disparaging prior art.
- Use neutral language: "conventional approaches" rather than "bad designs."
- Focus on technical limitations, not commercial failures.
- Do NOT mention the invention's solution in this section.`,
    constraints: ['Do not mention the present invention solution', 'Use objective, neutral language', 'Focus on technical limitations', '4-6 paragraphs total']
  },
  {
    sectionKey: 'objectsOfInvention',
    aliases: ['objects', 'objects_of_invention', 'objectOfInvention'],
    displayOrder: 5,
    label: 'Objects of the Invention',
    description: 'Specific objectives and goals the invention aims to achieve.',
    isRequired: false,
    requiresPriorArt: false,      // ❌ No prior art - uses Basic Information instead
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Patent Drafting Specialist.

**Task:** Generate the Objects of the Invention section.

**Structure:**
Use the format: "It is an object of the present invention to..."

**Guidelines:**
1. List 3-7 specific, technical objectives.
2. Each object should address a limitation from the background.
3. Objects should be achievable by the claimed invention.`,
    constraints: ['3-7 specific objectives', 'Use formal object statements', 'Link to problems in background', 'Technical language only']
  },
  {
    sectionKey: 'summary',
    aliases: ['summaryOfInvention', 'summary_of_invention', 'disclosure_of_invention', 'disclosureOfInvention'],
    displayOrder: 6,
    label: 'Summary of the Invention',
    description: 'A concise summary of the invention and its key features.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,         // ✅ Should align with claims
    requiresComponents: false,    // ❌ No components - high-level summary only
    instruction: `**Role:** Patent Claim Strategist.

**Task:** Generate a Summary that bridges the Background to the Detailed Description.

**Structure:**
1. **Solution Overview** (1 paragraph): Brief statement of what the invention provides.
2. **Key Features** (2-3 paragraphs): Describe the main technical features.
3. **Advantages** (1 paragraph): List the technical benefits achieved.

**Guidelines:**
- The summary should align with the broadest claim.
- Include all essential elements that will appear in Claim 1.
- Avoid unnecessary detail; save specifics for Detailed Description.`,
    constraints: ['Align with broadest claim', 'Use flexible language (embodiments, aspects)', '4-5 paragraphs total', 'Include essential elements from Claim 1']
  },
  {
    sectionKey: 'technicalProblem',
    aliases: ['technical_problem'],
    displayOrder: 7,
    label: 'Technical Problem',
    description: 'Clear statement of the technical problem solved (used in some jurisdictions like EP/JP).',
    isRequired: false,
    requiresPriorArt: true,       // ✅ Derived from prior art limitations
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Problem-Solution Analyst.

**Task:** Generate a clear Technical Problem statement.

**Guidelines:**
1. State the objective technical problem, not a commercial problem.
2. The problem should be one that a skilled person would recognize.
3. Frame in terms of what technical effect was lacking in the prior art.`,
    constraints: ['Objective technical problem only', 'Must be solvable by invention features', '1-2 paragraphs maximum']
  },
  {
    sectionKey: 'technicalSolution',
    aliases: ['technical_solution'],
    displayOrder: 8,
    label: 'Technical Solution',
    description: 'Description of how the invention solves the technical problem.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,         // ✅ Should align with claimed features
    requiresComponents: false,    // ❌ No components - derives from claims + problem only
    instruction: `**Role:** Technical Solution Architect.

**Task:** Generate a Technical Solution statement that directly addresses the Technical Problem.

**Guidelines:**
1. Describe how the distinguishing features solve the technical problem.
2. Explain the cause-effect relationship between features and benefits.`,
    constraints: ['Direct link to Technical Problem', 'Explain cause-effect relationship', '2-4 paragraphs']
  },
  {
    sectionKey: 'advantageousEffects',
    aliases: ['advantageous_effects'],
    displayOrder: 9,
    label: 'Advantageous Effects',
    description: 'Technical advantages and beneficial effects of the invention.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Benefits Analyst.

**Task:** Generate an Advantageous Effects section.

**Guidelines:**
1. List specific, measurable technical advantages.
2. Each advantage should be supported by features in the specification.
3. Avoid superlatives or marketing language.`,
    constraints: ['Specific, measurable advantages', 'Supported by specification', 'No marketing language', '3-6 advantages']
  },
  {
    sectionKey: 'briefDescriptionOfDrawings',
    aliases: ['brief_description_of_drawings', 'drawings', 'figures', 'brief_drawings'],
    displayOrder: 10,
    label: 'Brief Description of the Drawings',
    description: 'Descriptions of each figure in the patent drawings.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: true,        // ✅ MUST list all figures
    requiresClaims: false,
    requiresComponents: true,     // ✅ References components shown in figures
    instruction: `**Role:** Figure Cataloger.

**Task:** Generate brief descriptions for each drawing figure.

**Output Format:**
"FIG. 1 is a [type of view] showing [what it depicts]."`,
    constraints: ['One sentence per figure', 'Specify view type', 'Briefly describe content', 'Use consistent formatting']
  },
  {
    sectionKey: 'detailedDescription',
    aliases: ['detailed_description', 'detailedDescriptionOfInvention', 'detailed_description_of_invention'],
    displayOrder: 11,
    label: 'Detailed Description',
    description: 'Comprehensive description of the invention with reference to drawings.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: true,        // ✅ References figures throughout
    requiresClaims: false,        // ❌ No claims - must not use BI; uses technical sections + figures/components
    requiresComponents: true,     // ✅ Uses component numerals throughout
    instruction: `**Role:** Technical Writer and Patent Enablement Specialist.

**Task:** Generate a comprehensive Detailed Description that enables one skilled in the art to practice the invention.

**Structure:**
1. **Overview** (1-2 paragraphs): General description of the invention.
2. **System/Apparatus Description**: Describe each component and its function.
3. **Method/Process Description**: Describe operational steps.
4. **Embodiments**: Describe multiple embodiments with variations.

**Guidelines:**
- Reference figures: "As shown in FIG. 1, the system 100 includes..."
- Use reference numerals consistently.
- Describe best mode of practicing the invention.`,
    constraints: ['Enable skilled person to practice', 'Reference figures with numerals', 'Include multiple embodiments', 'Describe best mode']
  },
  {
    // IMPORTANT: canonical key is 'bestMethod' to match the legacy DB column in AnnexureDraft
    // 'bestMode' is an alias for backward compatibility
    sectionKey: 'bestMethod',
    aliases: ['best_mode', 'bestMode', 'best_method'],
    displayOrder: 12,
    label: 'Best Mode',
    description: 'Description of the best mode contemplated by the inventor (required in some jurisdictions).',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: true,        // ✅ May reference figures
    requiresClaims: false,
    requiresComponents: true,     // ✅ Uses component numerals
    instruction: `**Role:** Best Mode Compliance Officer.

**Task:** Ensure the specification discloses the best mode known to the inventor.`,
    constraints: ['Disclose preferred embodiment', 'Include specific parameters', 'Do not obscure best mode']
  },
  {
    sectionKey: 'industrialApplicability',
    aliases: ['industrial_applicability'],
    displayOrder: 13,
    label: 'Industrial Applicability',
    description: 'Statement of industrial applicability (required in some jurisdictions).',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Industrial Application Analyst.

**Task:** Generate an Industrial Applicability statement.

**Guidelines:**
1. Identify specific industries where the invention can be applied.
2. Describe how the invention can be made and used in industry.`,
    constraints: ['Identify specific industries', 'Describe practical applications', '1-2 paragraphs']
  },
  {
    sectionKey: 'claims',
    aliases: [],
    displayOrder: 14,
    label: 'Claims',
    description: 'The legal claims defining the scope of patent protection.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,        // Claims don't need claims context (they ARE the claims)
    requiresComponents: true,     // ✅ Uses component references
    instruction: `**Role:** Patent Claim Architect.

**Task:** Generate a complete claim set.

**Claim Structure:**
1. **Independent Claim 1**: Broadest apparatus/system claim
2. **Dependent Claims 2-5**: Narrowing features
3. **Independent Method Claim**: Parallel method claim

**Claim Drafting Rules:**
- Single sentence per claim
- Proper antecedent basis ("a processor" then "the processor")
- Transition phrases: "comprising," "consisting of," "consisting essentially of"`,
    constraints: ['Single sentence per claim', 'Proper antecedent basis', 'Clear transition phrases', '10-20 claims typical', 'Independent + dependent structure']
  },
  {
    sectionKey: 'abstract',
    aliases: [],
    displayOrder: 15,
    label: 'Abstract',
    description: 'A brief abstract summarizing the invention for searching purposes.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,       // ❌ No figures - abstract should be standalone
    requiresClaims: false,        // ❌ No claims - uses optional BI for high-level phrasing
    requiresComponents: false,
    instruction: `**Role:** Abstract Generator (USPTO/WIPO Compliant).

**Task:** Generate a patent abstract.

**Requirements:**
- Maximum 150 words (strict limit)
- Single paragraph
- Summarize the technical disclosure
- Include the title's subject matter`,
    constraints: ['Maximum 150 words', 'Single paragraph', 'Include key figure reference', 'No claims or legal language']
  },
  {
    sectionKey: 'listOfNumerals',
    aliases: ['list_of_numerals', 'numeralList', 'numeral_list', 'referenceNumerals', 'reference_numerals'],
    displayOrder: 16,
    label: 'List of Reference Numerals',
    description: 'A table or list mapping reference numerals to component names used in the specification.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: true,     // ✅ Lists all components
    instruction: `**Role:** Reference Numeral Cataloger.

**Task:** Generate a comprehensive list of reference numerals used in the specification.

**Format:**
- (100) - [Component Name]
- (101) - [Sub-component Name]`,
    constraints: ['List in numerical order', 'Use exact component names from specification', 'Include all numerals from drawings and description', 'Format: (XXX) - Component Name']
  },
  {
    sectionKey: 'crossReference',
    aliases: ['cross_reference', 'crossReferences', 'cross_references', 'relatedApplications', 'related_applications'],
    displayOrder: 17,
    label: 'Cross-Reference to Related Applications',
    description: 'References to related patent applications, priority claims, and continuations.',
    isRequired: false,
    requiresPriorArt: false,      // ❌ No prior art - procedural section only
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate a Cross-Reference to Related Applications section.

**Content Requirements:**
1. Priority claims from earlier applications
2. Continuation/divisional relationships
3. Related co-pending applications`,
    constraints: ['List applications chronologically', 'Include application numbers and filing dates', 'Specify relationship type clearly', 'Use proper legal terminology']
  }
];

// ============================================================================
// COUNTRY SECTION MAPPINGS (hardcoded for key jurisdictions)
// ============================================================================
const COUNTRY_MAPPINGS = {
  IN: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of the Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Field of the Invention', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Objects of Invention', sectionKey: 'objectsOfInvention', heading: 'Object(s) of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of the Invention', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 9, isRequired: true }
  ],
  US: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Cross-Reference', sectionKey: 'crossReference', heading: 'Cross-Reference to Related Applications', displayOrder: 2, isRequired: false },
    { supersetCode: '03. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of Preferred Embodiments', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Abstract', sectionKey: 'abstract', heading: 'Abstract of the Disclosure', displayOrder: 9, isRequired: true }
  ],
  EP: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Technical Problem', sectionKey: 'technicalProblem', heading: 'Technical Problem', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Technical Solution', sectionKey: 'technicalSolution', heading: 'Technical Solution', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Advantageous Effects', sectionKey: 'advantageousEffects', heading: 'Advantageous Effects', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 7, isRequired: false },
    { supersetCode: '08. Detailed Description', sectionKey: 'detailedDescription', heading: 'Description of Embodiments', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 9, isRequired: true },
    { supersetCode: '10. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 10, isRequired: true }
  ],
  PCT: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Technical Problem', sectionKey: 'technicalProblem', heading: 'Technical Problem', displayOrder: 4, isRequired: false },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Description of Embodiments', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Industrial Applicability', sectionKey: 'industrialApplicability', heading: 'Industrial Applicability', displayOrder: 8, isRequired: false },
    { supersetCode: '09. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 9, isRequired: true },
    { supersetCode: '10. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 10, isRequired: true }
  ],
  CA: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Field of the Invention', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 5, isRequired: false },
    { supersetCode: '06. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of the Preferred Embodiments', displayOrder: 6, isRequired: true },
    { supersetCode: '07. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 8, isRequired: true }
  ],
  AU: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Summary', sectionKey: 'summary', heading: 'Summary of Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 5, isRequired: false },
    // 'bestMethod' is the canonical key (matches SupersetSection and legacy DB column)
    { supersetCode: '06. Best Method', sectionKey: 'bestMethod', heading: 'Best Method of Performing the Invention', displayOrder: 6, isRequired: true },
    { supersetCode: '07. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 8, isRequired: true }
  ],
  JP: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Technical Problem', sectionKey: 'technicalProblem', heading: 'Problem to be Solved', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Technical Solution', sectionKey: 'technicalSolution', heading: 'Solution to Problem', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Advantageous Effects', sectionKey: 'advantageousEffects', heading: 'Advantageous Effects of Invention', displayOrder: 6, isRequired: true },
    { supersetCode: '07. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 7, isRequired: false },
    { supersetCode: '08. Detailed Description', sectionKey: 'detailedDescription', heading: 'Description of Embodiments', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Industrial Applicability', sectionKey: 'industrialApplicability', heading: 'Industrial Applicability', displayOrder: 9, isRequired: false },
    { supersetCode: '10. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 10, isRequired: true },
    { supersetCode: '11. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 11, isRequired: true }
  ]
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function getSystemUserId() {
  const superAdmin = await prisma.user.findFirst({
    where: { roles: { has: 'SUPER_ADMIN' } }
  });
  if (superAdmin) return superAdmin.id;

  const anyUser = await prisma.user.findFirst();
  if (anyUser) return anyUser.id;

  return null;
}

function loadCountryJson(filename) {
  const filepath = path.join(COUNTRIES_DIR, filename);
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function printHeader(title) {
  console.log('\n╔' + '═'.repeat(66) + '╗');
  console.log('║  ' + title.padEnd(64) + '║');
  console.log('╚' + '═'.repeat(66) + '╝\n');
}

// ============================================================================
// STEP 1: SEED SUPERSET SECTIONS
// ============================================================================

async function seedSupersetSections(systemUserId) {
  printHeader('📦 STEP 1: Seeding Superset Sections');

  let created = 0, updated = 0, skipped = 0;

  for (const section of SUPERSET_SECTIONS) {
    try {
      const existing = await prisma.supersetSection.findUnique({
        where: { sectionKey: section.sectionKey }
      });

      if (existing && !options.force) {
        skipped++;
        continue;
      }

      if (options.dryRun) {
        console.log(`  [DRY-RUN] Would ${existing ? 'update' : 'create'} ${section.sectionKey}`);
        if (existing) updated++; else created++;
        continue;
      }

      // Build context flags summary for logging
      const contextFlags = [
        section.requiresPriorArt ? 'priorArt' : null,
        section.requiresFigures ? 'figures' : null,
        section.requiresClaims ? 'claims' : null,
        section.requiresComponents ? 'components' : null
      ].filter(Boolean).join(',') || 'none';

      if (existing) {
        await prisma.supersetSection.update({
          where: { sectionKey: section.sectionKey },
          data: {
            displayOrder: section.displayOrder,
            label: section.label,
            description: section.description,
            instruction: section.instruction,
            constraints: section.constraints,
            isRequired: section.isRequired,
            aliases: section.aliases || [],
            // Context injection flags
            requiresPriorArt: section.requiresPriorArt ?? false,
            requiresFigures: section.requiresFigures ?? false,
            requiresClaims: section.requiresClaims ?? false,
            requiresComponents: section.requiresComponents ?? false,
            updatedBy: systemUserId
          }
        });
        console.log(`  ✏️  [UPDATE] ${section.sectionKey} (context: ${contextFlags})`);
        updated++;
      } else {
        await prisma.supersetSection.create({
          data: {
            sectionKey: section.sectionKey,
            displayOrder: section.displayOrder,
            label: section.label,
            description: section.description,
            instruction: section.instruction,
            constraints: section.constraints,
            isRequired: section.isRequired,
            aliases: section.aliases || [],
            isActive: true,
            // Context injection flags
            requiresPriorArt: section.requiresPriorArt ?? false,
            requiresFigures: section.requiresFigures ?? false,
            requiresClaims: section.requiresClaims ?? false,
            requiresComponents: section.requiresComponents ?? false,
            createdBy: systemUserId
          }
        });
        console.log(`  ✅ [CREATE] ${section.sectionKey} (context: ${contextFlags})`);
        created++;
      }
    } catch (err) {
      console.log(`  ❌ [ERROR] ${section.sectionKey}: ${err.message}`);
    }
  }

  console.log(`\n  📊 Summary: Created=${created}, Updated=${updated}, Skipped=${skipped}`);
  return { created, updated, skipped };
}

// ============================================================================
// STEP 2: SEED COUNTRY NAMES (from backup)
// ============================================================================

async function seedCountryNames() {
  printHeader('🌍 STEP 2: Seeding Country Names');

  // Load from backup file
  const backupPath = path.join(COUNTRIES_DIR, 'production-seed-backup.json');
  let countryNames = [];
  
  if (fs.existsSync(backupPath)) {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    countryNames = backup.tables?.countryName || [];
  }

  if (countryNames.length === 0) {
    console.log('  ⚠️  No country names found in backup, using defaults');
    // Production countries only (6 jurisdictions with fully configured mappings)
    countryNames = [
      { code: 'AU', name: 'Australia', continent: 'Oceania' },
      { code: 'CA', name: 'Canada', continent: 'North America' },
      { code: 'IN', name: 'India', continent: 'Asia' },
      { code: 'JP', name: 'Japan', continent: 'Asia' },
      { code: 'PCT', name: 'PCT International', continent: 'International' },
      { code: 'US', name: 'United States of America', continent: 'North America' }
    ];
  }

  let created = 0, updated = 0, skipped = 0;

  for (const country of countryNames) {
    if (options.country && country.code !== options.country) continue;

    try {
      const existing = await prisma.countryName.findUnique({
        where: { code: country.code }
      });

      if (existing && !options.force) {
        skipped++;
        continue;
      }

      if (options.dryRun) {
        if (existing) updated++; else created++;
        continue;
      }

      await prisma.countryName.upsert({
        where: { code: country.code },
        update: { name: country.name, continent: country.continent },
        create: { code: country.code, name: country.name, continent: country.continent }
      });

      if (existing) {
        updated++;
      } else {
        console.log(`  ✅ [CREATE] ${country.code}: ${country.name}`);
        created++;
      }
    } catch (err) {
      console.log(`  ❌ [ERROR] ${country.code}: ${err.message}`);
    }
  }

  console.log(`\n  📊 Summary: Created=${created}, Updated=${updated}, Skipped=${skipped}`);
  return { created, updated, skipped };
}

// ============================================================================
// STEP 3: SEED COUNTRY SECTION MAPPINGS
// ============================================================================

async function seedCountrySectionMappings() {
  printHeader('🗺️  STEP 3: Seeding Country Section Mappings');

  // First, load from backup
  const backupPath = path.join(COUNTRIES_DIR, 'production-seed-backup.json');
  let backupMappings = [];
  
  if (fs.existsSync(backupPath)) {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    backupMappings = backup.tables?.countrySectionMapping || [];
  }

  let created = 0, updated = 0, skipped = 0;

  // First seed from backup (for all countries)
  if (backupMappings.length > 0) {
    console.log(`  Loading ${backupMappings.length} mappings from backup...`);
    
    for (const mapping of backupMappings) {
      const countryCode = mapping.country_code;
      if (options.country && countryCode !== options.country) continue;

      try {
        const existing = await prisma.countrySectionMapping.findFirst({
          where: { countryCode, sectionKey: mapping.section_key }
        });

        if (existing && !options.force) {
          skipped++;
          continue;
        }

        if (options.dryRun) {
          if (existing) updated++; else created++;
          continue;
        }

        if (existing) {
          await prisma.countrySectionMapping.update({
            where: { id: existing.id },
            data: {
              supersetCode: mapping.superset_code,
              heading: mapping.heading,
              isRequired: mapping.is_required ?? true,
              isEnabled: mapping.is_enabled ?? true,
              displayOrder: mapping.display_order
            }
          });
          updated++;
        } else {
          await prisma.countrySectionMapping.create({
            data: {
              id: mapping.id,
              countryCode,
              supersetCode: mapping.superset_code,
              sectionKey: mapping.section_key,
              heading: mapping.heading,
              isRequired: mapping.is_required ?? true,
              isEnabled: mapping.is_enabled ?? true,
              displayOrder: mapping.display_order
            }
          });
          created++;
        }
      } catch (err) {
        // Ignore duplicate errors
      }
    }
  }

  // Then seed/update from hardcoded mappings (key countries)
  console.log(`  Processing hardcoded mappings for key jurisdictions...`);
  
  for (const [countryCode, sections] of Object.entries(COUNTRY_MAPPINGS)) {
    if (options.country && countryCode !== options.country) continue;

    for (const section of sections) {
      try {
        const existing = await prisma.countrySectionMapping.findFirst({
          where: { countryCode, sectionKey: section.sectionKey }
        });

        if (existing) {
          if (options.force) {
            if (!options.dryRun) {
              await prisma.countrySectionMapping.update({
                where: { id: existing.id },
                data: {
                  supersetCode: section.supersetCode,
                  heading: section.heading,
                  displayOrder: section.displayOrder,
                  isRequired: section.isRequired,
                  isEnabled: true
                }
              });
            }
            updated++;
          }
        } else {
          if (!options.dryRun) {
            await prisma.countrySectionMapping.create({
              data: {
                countryCode,
                supersetCode: section.supersetCode,
                sectionKey: section.sectionKey,
                heading: section.heading,
                displayOrder: section.displayOrder,
                isRequired: section.isRequired,
                isEnabled: true
              }
            });
          }
          created++;
        }
      } catch (err) {
        // Ignore errors
      }
    }
  }

  console.log(`\n  📊 Summary: Created=${created}, Updated=${updated}, Skipped=${skipped}`);
  return { created, updated, skipped };
}

// ============================================================================
// STEP 4: SEED SECTION PROMPTS (from JSON files)
// ============================================================================

async function seedSectionPrompts() {
  printHeader('📝 STEP 4: Seeding Country Section Prompts (Top-ups)');

  const files = fs.readdirSync(COUNTRIES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && !f.includes('backup') && !f.includes('sample'));

  let created = 0, updated = 0, skipped = 0;

  for (const file of files) {
    let countryCode = file.replace('.json', '').toUpperCase();
    if (countryCode === 'CANADA') countryCode = 'CA';
    if (options.country && countryCode !== options.country) continue;

    const profile = loadCountryJson(file);
    if (!profile?.prompts?.sections) continue;

    console.log(`  Processing ${countryCode}...`);
    const sections = profile.prompts.sections;

    for (const [sectionKey, config] of Object.entries(sections)) {
      const topUp = config.topUp || config;
      if (!topUp?.instruction) continue;

      try {
        const existing = await prisma.countrySectionPrompt.findFirst({
          where: { countryCode, sectionKey }
        });

        if (existing && !options.force) {
          skipped++;
          continue;
        }

        const promptData = {
          countryCode,
          sectionKey,
          instruction: topUp.instruction,
          constraints: topUp.constraints || [],
          additions: topUp.additions || [],
          version: existing ? existing.version + 1 : 1,
          status: 'ACTIVE',
          createdBy: 'system:seed',
          updatedBy: existing ? 'system:seed' : null
        };

        if (options.dryRun) {
          if (existing) updated++; else created++;
          continue;
        }

        if (existing) {
          await prisma.countrySectionPrompt.update({
            where: { id: existing.id },
            data: promptData
          });
          updated++;
        } else {
          const newPrompt = await prisma.countrySectionPrompt.create({ data: promptData });
          
          // Create history entry
          await prisma.countrySectionPromptHistory.create({
            data: {
              promptId: newPrompt.id,
              countryCode,
              sectionKey,
              instruction: promptData.instruction,
              constraints: promptData.constraints,
              additions: promptData.additions,
              version: 1,
              changeType: 'CREATE',
              changeReason: 'Initial seed from MasterSeed',
              changedBy: 'system:seed'
            }
          });
          
          console.log(`    ✅ ${sectionKey}`);
          created++;
        }
      } catch (err) {
        console.log(`    ❌ ${sectionKey}: ${err.message}`);
      }
    }
  }

  console.log(`\n  📊 Summary: Created=${created}, Updated=${updated}, Skipped=${skipped}`);
  return { created, updated, skipped };
}

// ============================================================================
// STEP 5: SEED COUNTRY PROFILES
// ============================================================================

async function seedCountryProfiles(systemUserId) {
  printHeader('📋 STEP 5: Seeding Country Profiles');

  const files = fs.readdirSync(COUNTRIES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && !f.includes('backup') && !f.includes('sample'));

  let created = 0, updated = 0, skipped = 0;

  for (const file of files) {
    let countryCode = file.replace('.json', '').toUpperCase();
    if (countryCode === 'CANADA') countryCode = 'CA';
    if (options.country && countryCode !== options.country) continue;

    const profileData = loadCountryJson(file);
    if (!profileData?.meta) continue;

    const name = profileData.meta?.name || countryCode;

    try {
      const existing = await prisma.countryProfile.findUnique({
        where: { countryCode }
      });

      if (existing && !options.force) {
        skipped++;
        continue;
      }

      if (options.dryRun) {
        console.log(`  [DRY-RUN] Would ${existing ? 'update' : 'create'} ${countryCode}`);
        if (existing) updated++; else created++;
        continue;
      }

      if (existing) {
        await prisma.countryProfile.update({
          where: { countryCode },
          data: {
            name,
            profileData,
            version: existing.version + 1,
            status: 'ACTIVE',
            updatedBy: systemUserId
          }
        });
        console.log(`  ✏️  [UPDATE] ${countryCode}: ${name}`);
        updated++;
      } else {
        await prisma.countryProfile.create({
          data: {
            countryCode,
            name,
            profileData,
            version: 1,
            status: 'ACTIVE',
            createdBy: systemUserId
          }
        });
        console.log(`  ✅ [CREATE] ${countryCode}: ${name}`);
        created++;
      }
    } catch (err) {
      console.log(`  ❌ [ERROR] ${countryCode}: ${err.message}`);
    }
  }

  console.log(`\n  📊 Summary: Created=${created}, Updated=${updated}, Skipped=${skipped}`);
  return { created, updated, skipped };
}

// ============================================================================
// STEP 6: SEED JURISDICTION STYLES
// ============================================================================

async function seedJurisdictionStyles() {
  printHeader('🎨 STEP 6: Seeding Jurisdiction Styles');

  if (options.skipStyles) {
    console.log('  ⏭️  Skipped (--skip-styles flag)');
    return { created: 0, updated: 0, skipped: 0 };
  }

  const files = fs.readdirSync(COUNTRIES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && !f.includes('backup') && !f.includes('sample'));

  let totalCreated = 0, totalUpdated = 0, totalSkipped = 0;

  for (const file of files) {
    let countryCode = file.replace('.json', '').toUpperCase();
    if (countryCode === 'CANADA') countryCode = 'CA';
    if (options.country && countryCode !== options.country) continue;

    const json = loadCountryJson(file);
    if (!json?.meta) continue;

    console.log(`  Processing ${countryCode}...`);

    // Seed Diagram Config
    if (json.diagrams) {
      try {
        const existing = await prisma.countryDiagramConfig.findUnique({ where: { countryCode } });
        
        if (!existing || options.force) {
          const drawingRules = json.rules?.drawings || {};
          
          const configData = {
            countryCode,
            requiredWhenApplicable: json.diagrams.requiredWhenApplicable ?? true,
            supportedDiagramTypes: json.diagrams.supportedDiagramTypes || ['block', 'flowchart', 'schematic'],
            figureLabelFormat: json.diagrams.figureLabelFormat || 'Fig. {number}',
            autoGenerateReferenceTable: json.diagrams.autoGenerateReferenceTable ?? true,
            paperSize: drawingRules.paperSize || 'A4',
            colorAllowed: drawingRules.colorAllowed ?? false,
            colorUsageNote: drawingRules.colorUsageNote || null,
            lineStyle: drawingRules.lineStyle || 'black_and_white_solid',
            referenceNumeralsMandatory: drawingRules.referenceNumeralsMandatoryWhenDrawings ?? true,
            minReferenceTextSizePt: drawingRules.minReferenceTextSizePt || 8,
            drawingMarginTopCm: drawingRules.marginTopCm || 2.5,
            drawingMarginBottomCm: drawingRules.marginBottomCm || 1.0,
            drawingMarginLeftCm: drawingRules.marginLeftCm || 2.5,
            drawingMarginRightCm: drawingRules.marginRightCm || 1.5,
            defaultDiagramCount: 4,
            maxDiagramsRecommended: 10,
            version: existing ? existing.version + 1 : 1,
            status: 'ACTIVE',
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID
          };

          if (!options.dryRun) {
            const result = await prisma.countryDiagramConfig.upsert({
              where: { countryCode },
              create: configData,
              update: configData
            });

            // Seed diagram hints
            if (json.diagrams.diagramGenerationHints) {
              for (const [diagramType, hint] of Object.entries(json.diagrams.diagramGenerationHints)) {
                await prisma.countryDiagramHint.upsert({
                  where: { configId_diagramType: { configId: result.id, diagramType } },
                  create: { configId: result.id, diagramType, hint, preferredSyntax: 'plantuml', requireLabels: true },
                  update: { hint }
                });
              }
            }
          }
          
          if (existing) totalUpdated++; else totalCreated++;
        } else {
          totalSkipped++;
        }
      } catch (err) {
        console.log(`    ❌ DiagramConfig: ${err.message}`);
      }
    }

    // Seed Export Config
    if (json.export?.documentTypes && Array.isArray(json.export.documentTypes)) {
      for (const docType of json.export.documentTypes) {
        try {
          const existing = await prisma.countryExportConfig.findUnique({
            where: { countryCode_documentTypeId: { countryCode, documentTypeId: docType.id || 'spec_pdf' } }
          });

          if (!existing || options.force) {
            const configData = {
              countryCode,
              documentTypeId: docType.id || 'spec_pdf',
              label: docType.label || `${countryCode} Specification`,
              description: docType.description || null,
              pageSize: docType.pageSize || 'A4',
              marginTopCm: docType.marginTopCm || 2.5,
              marginBottomCm: docType.marginBottomCm || 2.0,
              marginLeftCm: docType.marginLeftCm || 2.5,
              marginRightCm: docType.marginRightCm || 2.0,
              fontFamily: docType.fontFamily || 'Times New Roman',
              fontSizePt: docType.fontSizePt || 12,
              lineSpacing: docType.lineSpacing || 1.5,
              addPageNumbers: docType.addPageNumbers ?? true,
              addParagraphNumbers: docType.addParagraphNumbers ?? false,
              pageNumberFormat: 'Page {page} of {total}',
              pageNumberPosition: 'header-right',
              includesSections: docType.includesSections || [],
              sectionOrder: [],
              version: existing ? existing.version + 1 : 1,
              status: 'ACTIVE',
              createdBy: SYSTEM_USER_ID,
              updatedBy: SYSTEM_USER_ID
            };

            if (!options.dryRun) {
              const result = await prisma.countryExportConfig.upsert({
                where: { countryCode_documentTypeId: { countryCode, documentTypeId: configData.documentTypeId } },
                create: configData,
                update: configData
              });

              // Seed export headings
              if (json.export.sectionHeadings) {
                for (const [sectionKey, heading] of Object.entries(json.export.sectionHeadings)) {
                  await prisma.countryExportHeading.upsert({
                    where: { exportConfigId_sectionKey: { exportConfigId: result.id, sectionKey } },
                    create: { exportConfigId: result.id, sectionKey, heading, style: heading === heading.toUpperCase() ? 'uppercase' : 'titlecase' },
                    update: { heading, style: heading === heading.toUpperCase() ? 'uppercase' : 'titlecase' }
                  });
                }
              }
            }

            if (existing) totalUpdated++; else totalCreated++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          console.log(`    ❌ ExportConfig: ${err.message}`);
        }
      }
    }

    // Seed Section Validations
    if (json.validation?.sectionChecks) {
      for (const [sectionKey, checks] of Object.entries(json.validation.sectionChecks)) {
        if (!Array.isArray(checks) || checks.length === 0) continue;

        try {
          const existing = await prisma.countrySectionValidation.findUnique({
            where: { countryCode_sectionKey: { countryCode, sectionKey } }
          });

          if (!existing || options.force) {
            const validationData = {
              countryCode,
              sectionKey,
              version: existing ? existing.version + 1 : 1,
              status: 'ACTIVE',
              createdBy: SYSTEM_USER_ID,
              updatedBy: SYSTEM_USER_ID,
              additionalRules: {}
            };

            for (const check of checks) {
              switch (check.type) {
                case 'maxWords': validationData.maxWords = check.limit; break;
                case 'minWords': validationData.minWords = check.limit; break;
                case 'maxChars': validationData.maxChars = check.limit; break;
                case 'minChars': validationData.minChars = check.limit; break;
                case 'maxCount': validationData.maxCount = check.limit; break;
              }
            }

            if (!options.dryRun) {
              await prisma.countrySectionValidation.upsert({
                where: { countryCode_sectionKey: { countryCode, sectionKey } },
                create: validationData,
                update: validationData
              });
            }

            if (existing) totalUpdated++; else totalCreated++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    // Seed Cross Validations
    if (json.validation?.crossSectionChecks) {
      for (const check of json.validation.crossSectionChecks) {
        try {
          const checkId = check.id || `${check.type}_${check.from}`;
          const existing = await prisma.countryCrossValidation.findUnique({
            where: { countryCode_checkId: { countryCode, checkId } }
          });

          if (!existing || options.force) {
            const toSections = check.mustBeSupportedBy || check.mustBeConsistentWith || check.mustBeShownIn || [];
            
            const validationData = {
              countryCode,
              checkId,
              checkType: check.type,
              fromSection: check.from,
              toSections,
              severity: check.severity || 'warning',
              message: check.message,
              reviewPrompt: `Review ${check.from} for compliance`,
              checkParams: {},
              isEnabled: true,
              version: existing ? existing.version + 1 : 1
            };

            if (!options.dryRun) {
              await prisma.countryCrossValidation.upsert({
                where: { countryCode_checkId: { countryCode, checkId } },
                create: validationData,
                update: validationData
              });
            }

            if (existing) totalUpdated++; else totalCreated++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          // Ignore
        }
      }
    }
  }

  console.log(`\n  📊 Summary: Created=${totalCreated}, Updated=${totalUpdated}, Skipped=${totalSkipped}`);
  return { created: totalCreated, updated: totalUpdated, skipped: totalSkipped };
}

// ============================================================================
// VERIFICATION
// ============================================================================

async function verify() {
  printHeader('📊 VERIFICATION');

  const ss = await prisma.supersetSection.count();
  const cn = await prisma.countryName.count();
  const csm = await prisma.countrySectionMapping.count();
  const csp = await prisma.countrySectionPrompt.count();
  const cp = await prisma.countryProfile.count();

  console.log('  Core Tables:');
  console.log(`    • Superset Sections: ${ss}`);
  console.log(`    • Country Names: ${cn}`);
  console.log(`    • Section Mappings: ${csm}`);
  console.log(`    • Section Prompts: ${csp}`);
  console.log(`    • Country Profiles: ${cp}`);

  try {
    const cdc = await prisma.countryDiagramConfig.count();
    const cec = await prisma.countryExportConfig.count();
    const csv = await prisma.countrySectionValidation.count();
    const ccv = await prisma.countryCrossValidation.count();

    console.log('\n  Jurisdiction Styles:');
    console.log(`    • Diagram Configs: ${cdc}`);
    console.log(`    • Export Configs: ${cec}`);
    console.log(`    • Section Validations: ${csv}`);
    console.log(`    • Cross-Validations: ${ccv}`);
  } catch (e) {
    console.log('\n  (Jurisdiction style tables not available)');
  }

  // Show by country
  console.log('\n  Mappings by Country:');
  const byCountry = await prisma.countrySectionMapping.groupBy({
    by: ['countryCode'],
    _count: { id: true },
    orderBy: { countryCode: 'asc' }
  });
  byCountry.forEach(c => console.log(`    ${c.countryCode}: ${c._count.id} sections`));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔' + '═'.repeat(66) + '╗');
  console.log('║' + '                    🌱 MASTER SEED SCRIPT                        '.padEnd(66) + '║');
  console.log('║' + '           Multi-Country Patent Filing System                    '.padEnd(66) + '║');
  console.log('╚' + '═'.repeat(66) + '╝');
  console.log('');
  console.log(`Options: ${options.force ? '--force ' : ''}${options.dryRun ? '--dry-run ' : ''}${options.country ? `--country=${options.country} ` : ''}${options.skipStyles ? '--skip-styles' : ''}`);

  try {
    const systemUserId = await getSystemUserId();
    if (!systemUserId) {
      console.warn('\n⚠️  Warning: No users found. Run: node scripts/setup-full-hierarchy.js first\n');
    } else {
      console.log(`\n👤 Using system user: ${systemUserId}`);
    }

    const results = {};
    
    results.supersetSections = await seedSupersetSections(systemUserId);
    results.countryNames = await seedCountryNames();
    results.sectionMappings = await seedCountrySectionMappings();
    results.sectionPrompts = await seedSectionPrompts();
    results.countryProfiles = await seedCountryProfiles(systemUserId);
    results.jurisdictionStyles = await seedJurisdictionStyles();

    // Final summary
    console.log('\n' + '═'.repeat(68));
    console.log('                         🏁 FINAL SUMMARY');
    console.log('═'.repeat(68));
    
    let totalCreated = 0, totalUpdated = 0, totalSkipped = 0;
    for (const [key, val] of Object.entries(results)) {
      totalCreated += val.created || 0;
      totalUpdated += val.updated || 0;
      totalSkipped += val.skipped || 0;
    }
    
    console.log(`  Total Created: ${totalCreated}`);
    console.log(`  Total Updated: ${totalUpdated}`);
    console.log(`  Total Skipped: ${totalSkipped}`);

    if (options.dryRun) {
      console.log('\n  🔍 [DRY-RUN] No changes were made to the database.');
    }

    await verify();

    console.log('\n✅ Master seed completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Start the server: npm run dev');
    console.log('  2. Login as superadmin@spotipr.com');
    console.log('  3. Visit /super-admin/jurisdiction-config to verify');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('  1. Run migrations: npx prisma migrate deploy');
    console.log('  2. Create users: node scripts/setup-full-hierarchy.js');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

