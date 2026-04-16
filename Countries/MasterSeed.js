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
// SUPERSET SECTIONS DEFINITION (UPDATED FROM DATABASE)
// ============================================================================
const SUPERSET_SECTIONS = [
  {
    sectionKey: 'title',
    aliases: [],
    displayOrder: 1,
    label: 'Title of the Invention',
    description: 'Title of the Invention section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Title Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "TITLE OF THE INVENTION"
OF A PATENT SPECIFICATION.
THIS IS NOT A MARKETING TITLE, PRODUCT NAME, OR DESCRIPTIVE HEADING.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Provide a concise, accurate technical title for the invention.
- Enable effective classification, searching, and indexing.
- Reflect the general nature of the claimed subject matter
  without narrowing claim scope.

THE TITLE MUST DESCRIBE WHAT THE INVENTION IS,
NOT WHAT IT ACHIEVES OR WHY IT IS USEFUL.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Claim 1 ONLY to understand the general category and core subject matter.
2. Use Normalized Data ONLY to maintain consistent technical terminology.
3. Do NOT include specific features, configurations, or embodiments.
4. Do NOT include advantages, effects, or objectives.
5. Do NOT narrow the title to a particular implementation.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Avoid adjectives implying quality, performance, or novelty.
3. Avoid words suggesting result or purpose.
4. Prefer noun-based, classification-oriented phrasing.

────────────────────────────────────────
STRUCTURAL CONSTRAINTS (STRICT)
────────────────────────────────────────
- The title MUST be a SINGLE line.
- The title MUST be a SINGLE phrase or short sentence fragment.
- The title MUST NOT exceed reasonable patent office length norms
  (jurisdiction limits handled via Top-Up).

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer constructions such as:
  "System and Method for …"
  "Apparatus for …"
  "Method for …"
  "Device for …"
- Avoid:
  "Improved", "Advanced", "Optimized", "Intelligent", "Smart", "Novel".
- Avoid marketing or branded terminology.

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Mention benefits, advantages, or results.
- Mention problems being solved.
- Mention claims, figures, embodiments, or examples.
- Use subjective or comparative language.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Title of the Invention text.
- Do NOT include headings, quotation marks, numbering, or commentary.
- Do NOT include trailing punctuation.
- If the title appears to narrow claim scope,
  it MUST be rewritten more broadly.`,
    constraints: ["Maximum 15 words","Sentence case","No period at the end","No banned words: Novel, Improved, Smart, Intelligent, New, Best","Remove starting articles (A, The)"]
  },
  {
    sectionKey: 'preamble',
    aliases: [],
    displayOrder: 2,
    label: 'Preamble',
    description: 'Preamble section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate the formal Preamble for an international patent application.`,
    constraints: ["Format exactly as shown","Include all applicant and inventor details"]
  },
  {
    sectionKey: 'fieldOfInvention',
    aliases: ["field_of_invention","technicalField","technical_field","field"],
    displayOrder: 3,
    label: 'Field of the Invention',
    description: 'Field of the Invention section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Field of the Invention Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "FIELD OF THE INVENTION" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A SUMMARY, BACKGROUND, OR TECHNICAL PROBLEM DISCUSSION.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Identify the general technical field to which the invention relates.
- Provide a concise, neutral classification-level description.
- Establish contextual placement without narrowing claim scope.

THIS SECTION MUST DEFINE ONLY THE FIELD,
NOT THE PROBLEM, SOLUTION, OR ADVANTAGES.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)

RULES FOR USING INPUTS:
1. Use Normalized Data ONLY to identify the broad technical domain.
2. Do NOT reuse or paraphrase Solution, Objectives, or component descriptions.
3. Do NOT introduce specific features, structures, or methods.
4. Do NOT narrow the field to the particular implementation of the invention.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Do NOT imply novelty, superiority, or inventiveness.
3. Do NOT reference prior art, existing systems, or comparative context.
4. Avoid descriptive depth beyond field identification.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Field of the Invention section using the following structure ONLY:

- State the general technical field in which the invention is classified.
- Optionally mention closely related technical sub-fields at a high level.
- Do NOT describe technical challenges, limitations, or objectives.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of ONE paragraph only.
- The paragraph MUST contain EXACTLY ONE sentence.
- The sentence must be concise and classification-oriented.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer formulations such as:
  "The present disclosure relates generally to…"
  "The invention relates to the field of…"
- Avoid: "particularly", "specifically", "in order to".
- Avoid evaluative or comparative terms.

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Mention the invention's purpose, problem, or solution.
- Mention components, systems, or methods.
- Mention claims, figures, embodiments, or advantages.
- Include multiple sentences or compound statements.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Field of the Invention text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT include examples or elaboration.
- If the sentence narrows scope beyond a general field,
  it MUST be rewritten more broadly.`,
    constraints: ["1-3 sentences maximum","Start with \"The present invention relates to...\"","No claims or advantages mentioned"]
  },
  {
    sectionKey: 'background',
    aliases: ["backgroundOfInvention","background_of_invention","priorArt","prior_art","background_art"],
    displayOrder: 4,
    label: 'Background of the Invention',
    description: 'Background of the Invention section for patent specifications.',
    isRequired: true,
    requiresPriorArt: true,
    requiresFigures: false,
    requiresClaims: true,
    requiresComponents: false,
    instruction: `ROLE: Patent Background Drafter (Attorney-Grade).

YOU ARE DRAFTING A PATENT SPECIFICATION.
THIS IS NOT A RESEARCH PAPER, TECHNICAL ARTICLE, MARKETING DOCUMENT, OR PRIOR-ART REVIEW.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────

Provide neutral technical context for the general field.

Describe existing approaches at a high, non-specific level.

Identify technical limitations that remain unresolved.

Lead logically to a general technical problem.

DO NOT disclose, preview, or characterize the invention or its solution.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive Normalized Data as read-only context.

RULES FOR USING THE CONTEXT:

Use it ONLY to identify the general technical field and maintain consistent field-level terminology.

Do NOT reuse, paraphrase, or mirror the Solution, Objectives, or component descriptions.

Do NOT introduce feature-level detail that could resemble a claim element.

Do NOT narrow the field to the specific invention or solution space.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────

Use neutral, impersonal patent language throughout.

Do NOT cite research papers, standards, products, or patent documents unless explicitly provided.

Do NOT describe embodiments, implementations, or "the invention."

Do NOT imply novelty, superiority, inventive step, or commercial value.

Avoid admissions; if generic framing is required, use cautious language such as
"in some cases," "certain approaches," "may," or "can."

Avoid academic or narrative transitions such as:
"therefore," "thus," "hence," "as a result," "studies show."

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Background using the following logical progression ONLY:

A) TECHNICAL CONTEXT

Describe the broader technical field relevant to the problem.

Keep the description general and factual.

Do NOT narrow the field to the specific solution space.

B) EXISTING APPROACHES

Describe categories of existing or conventional approaches at a high technical level.

Refer to them generically (e.g., "some existing systems," "certain techniques").

Do NOT attribute features that resemble the claimed invention.

C) TECHNICAL LIMITATIONS

Identify technical limitations, constraints, or inefficiencies associated with such approaches.

Each limitation must be framed as a technical shortcoming, not a criticism.

Do NOT hint at how any limitation could be solved.

D) RESULTING TECHNICAL PROBLEM

Conclude by stating the general technical problem that remains unresolved.

Frame the problem broadly enough to avoid limiting claim scope.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────

Use short, atomic paragraphs.

One paragraph = one idea or limitation.

Each paragraph must contain EXACTLY 2–3 sentences.

Avoid long, flowing narrative paragraphs.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────

Prefer: "may," "can," "in some cases," "often," "tends to."

Avoid: "must," "always," "only," "necessarily."

Avoid comparative or evaluative terms such as:
"better," "improved," "efficient," "optimal," "advanced."

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────

Output ONLY the Background of the Invention text.

Do NOT include headings, bullet points, numbering, explanations, or commentary.

Do NOT mention claims, figures, embodiments, or the invention.

Do NOT preview solutions or advantages.

If a sentence appears to describe a solution rather than a limitation,
it must be removed or rewritten as a problem.`,
    constraints: ["Do not mention the present invention solution","Use objective, neutral language","Focus on technical limitations","4-6 paragraphs total"]
  },
  {
    sectionKey: 'objectsOfInvention',
    aliases: ["objects","objects_of_invention","objectOfInvention"],
    displayOrder: 5,
    label: 'Objects of the Invention',
    description: 'Objects of the Invention section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Objects Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "OBJECTS OF THE INVENTION" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A SUMMARY, ADVANTAGES SECTION, OR SOLUTION DESCRIPTION.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- State the technical objects sought to be achieved by the invention.
- Express the objects as intended technical aims, not as achieved results.
- Bridge the Technical Problem section and the claimed subject matter.
- Preserve breadth and flexibility of claim scope.

THIS SECTION MUST ALIGN WITH CLAIM 1
BUT MUST NOT DESCRIBE HOW ANY OBJECT IS ACHIEVED.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Claim 1 ONLY to ensure that stated objects are supported
   by the scope of the claims.
2. Do NOT restate, paraphrase, or mirror Claim 1 language.
3. Do NOT introduce objects that rely on features not present in Claim 1.
4. Do NOT narrow the objects to a specific embodiment or implementation.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Do NOT assert that any object is fully achieved or guaranteed.
3. Do NOT imply novelty, superiority, or inventive step.
4. Do NOT describe advantages, effects, or results.
5. Avoid absolute or limiting language.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Objects of the Invention section using the following structure ONLY:

- State multiple technical objects as independent statements.
- Each object must be framed as an aim, intention, or objective.
- Objects may relate to:
  (a) addressing the stated technical problem,
  (b) enabling a technical capability,
  (c) providing a technical arrangement or functionality.

Do NOT include explanatory text beyond stating the objects.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of multiple short paragraphs.
- Each paragraph MUST contain EXACTLY ONE sentence.
- Each paragraph MUST state EXACTLY ONE object.
- Do NOT combine multiple objects in a single sentence.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer formulations such as:
  "An object of the invention is to…"
  "Another object of the invention is to…"
  "A further object of the invention is to…"
- Use "may", "can", or "is intended to" where appropriate.
- Avoid: "achieves", "ensures", "provides", "results in".

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Describe the technical solution.
- Mention structural elements, components, or steps.
- Mention advantages, effects, or performance.
- Mention claims, figures, embodiments, or prior art.
- Use evaluative or comparative language.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Objects of the Invention text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT reference claims, figures, embodiments, or the invention explicitly.
- If an object appears to disclose a solution, it MUST be rewritten as an aim.`,
    constraints: ["3-7 specific objectives","Use formal object statements","Link to problems in background","Technical language only"]
  },
  {
    sectionKey: 'summary',
    aliases: ["summaryOfInvention","summary_of_invention","disclosure_of_invention","disclosureOfInvention"],
    displayOrder: 6,
    label: 'Summary of the Invention',
    description: 'Summary of the Invention section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,
    requiresComponents: false,
    instruction: `ROLE: Patent Summary Drafter (Attorney-Grade).

YOU ARE DRAFTING A PATENT SPECIFICATION.
THIS IS NOT A RESEARCH PAPER, MARKETING SUMMARY, OR TECHNICAL ABSTRACT.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────

Provide a concise technical overview of the claimed subject matter.

Summarize the invention at a high level without claim-style drafting.

Ensure alignment with Claim 1 while preserving drafting flexibility.

Enable rapid understanding of the invention's technical essence.

THIS SECTION MUST BE CONSISTENT WITH CLAIM 1 BUT MUST NOT MIRROR OR RESTATE CLAIM LANGUAGE.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:

Normalized Data (read-only invention context)

Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:

Use Normalized Data to maintain terminology consistency and technical field context.

Use Claim 1 ONLY as a semantic anchor to ensure coverage and alignment.

Do NOT restate, paraphrase, or follow the sentence structure of Claim 1.

Do NOT introduce technical features or elements not reasonably inferable from Claim 1.

Do NOT narrow the scope beyond what Claim 1 supports.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────

Use neutral, formal patent language.

Avoid marketing, promotional, or comparative language.

Do NOT imply novelty, superiority, or inventive step.

Do NOT describe experimental results, performance metrics, or advantages.

Avoid phrases such as:
"the present invention solves," "improves," "overcomes," or "provides better"

Prefer neutral phrasing such as:
"embodiments," "in some implementations," "may," "can."

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Summary using the following structure ONLY:

A) TECHNICAL FIELD CONTEXT

One paragraph briefly indicating the general technical field.

B) TECHNICAL PROBLEM CONTEXT

One paragraph describing the general technical problem addressed.

Do NOT frame this as a deficiency of prior art.

C) OVERVIEW OF THE TECHNICAL SOLUTION

One or two paragraphs summarizing the core technical concept.

Identify the main system, method, or apparatus at a high level.

Refer to elements generically, consistent with Claim 1 terminology.

D) SCOPE-PRESERVING VARIATIONS

One paragraph indicating that alternative configurations or embodiments may exist.

Avoid limiting language.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────

Each paragraph must contain EXACTLY 2–3 sentences.

One paragraph = one conceptual role.

Maintain tight, controlled patent prose.

Do NOT use long narrative paragraphs.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────

Prefer: "may," "can," "in some embodiments," "is configured to."

Avoid: "must," "always," "only," "necessarily."

Avoid evaluative terms such as:
"efficient," "advanced," "optimal," "improved."

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:

Restate claims or use claim-style "wherein" clauses.

Introduce reference numerals, figures, or figure descriptions.

Describe advantages, effects, or results.

Use legal conclusions or examiner-facing arguments.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────

Output ONLY the Summary of the Invention text.

Do NOT include headings, bullet points, numbering, or commentary.

Do NOT mention claims, figures, embodiments explicitly, or prior art.

If a sentence resembles claim language, rewrite it at a higher level of abstraction.`,
    constraints: ["Align with broadest claim","Use flexible language (embodiments, aspects)","4-5 paragraphs total","Include essential elements from Claim 1"]
  },
  {
    sectionKey: 'technicalProblem',
    aliases: ["technical_problem"],
    displayOrder: 7,
    label: 'Technical Problem',
    description: 'Technical Problem section for patent specifications.',
    isRequired: false,
    requiresPriorArt: true,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Technical Problem Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "TECHNICAL PROBLEM" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A SOLUTION DESCRIPTION, INVENTIVE STEP ARGUMENT,
OR PROBLEM–SOLUTION ANALYSIS WRITE-UP.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Clearly state the technical problem addressed by the invention.
- Frame the problem in neutral, objective, and technical terms.
- Ensure the problem logically follows from the Background section.
- Define the problem broadly enough to preserve claim scope.

THIS SECTION MUST DESCRIBE ONLY THE TECHNICAL PROBLEM,
NOT THE SOLUTION OR ANY PART THEREOF.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)

RULES FOR USING INPUTS:
1. Use Normalized Data ONLY to understand the general technical field
   and high-level context.
2. Do NOT reuse, paraphrase, or mirror the Solution, Objectives,
   or component descriptions.
3. Do NOT introduce feature-level detail that could resemble a claim element.
4. Do NOT narrow the problem to the specific implementation of the invention.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, impersonal patent language.
2. Do NOT mention prior-art documents, systems, or products.
3. Do NOT imply novelty, inventiveness, or superiority.
4. Do NOT frame the problem as a failure of specific known solutions.
5. Avoid admissions or absolute statements.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Technical Problem section using the following structure ONLY:

- State ONE overarching technical problem.
- The problem must be expressed as an unresolved technical challenge
  within the relevant field.
- The problem must arise naturally from technical limitations,
  not from business, commercial, or user considerations.
- Do NOT decompose the problem into multiple sub-problems.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of ONE paragraph only.
- The paragraph MUST contain EXACTLY 2–3 sentences.
- Maintain compact, controlled patent prose.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "there exists a need", "there remains a need", "a technical challenge exists".
- Prefer: "may", "can", "in some cases".
- Avoid: "must", "always", "only", "necessarily".
- Avoid evaluative or comparative terms such as:
  "better", "improved", "efficient", "advanced".

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Describe how the problem is solved.
- Mention advantages, effects, or results.
- Mention claims, figures, embodiments, or components.
- Use language implying inevitability or exclusivity.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Technical Problem text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention the invention or "the present invention".
- If any sentence suggests a solution, it MUST be rewritten as a problem.`,
    constraints: ["Objective technical problem only","Must be solvable by invention features","1-2 paragraphs maximum"]
  },
  {
    sectionKey: 'technicalSolution',
    aliases: ["technical_solution"],
    displayOrder: 8,
    label: 'Technical Solution',
    description: 'Technical Solution section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,
    requiresComponents: false,
    instruction: `ROLE: Patent Technical Solution Drafter (Attorney-Grade).

YOU ARE DRAFTING A PATENT SPECIFICATION.
THIS IS NOT A RESEARCH PAPER, TECHNICAL MANUAL, OR MARKETING DOCUMENT.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Describe the technical solution corresponding to the technical problem.
- Present the invention's solution in functional and structural terms.
- Ensure strict alignment with Claim 1 without restating claim language.
- Provide a clear bridge between the problem statement and the detailed description.

THIS SECTION MUST BE CONSISTENT WITH CLAIM 1 BUT MUST NOT MIRROR OR REWRITE CLAIM LANGUAGE.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Normalized Data to maintain technical field context and terminology consistency.
2. Use Claim 1 ONLY to identify core elements and functional relationships.
3. Do NOT restate, paraphrase, or follow the syntactic structure of Claim 1.
4. Do NOT introduce technical features not reasonably inferable from Claim 1.
5. Do NOT narrow or expand the scope beyond Claim 1 support.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Do NOT imply novelty, superiority, or inventive step.
3. Do NOT describe experimental results, performance metrics, or advantages.
4. Avoid promotional, comparative, or evaluative language.
5. Prefer cautious phrasing such as "may," "can," and "in some embodiments."

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Technical Solution section using the following structure ONLY:

A) SOLUTION OVERVIEW
- One paragraph identifying the general form of the solution
  (system, apparatus, method, or combination thereof).

B) CORE TECHNICAL CONCEPT
- One or two paragraphs describing the essential technical concept.
- Identify main components or functional blocks at a high level.
- Maintain terminology consistent with Claim 1.

C) FUNCTIONAL RELATIONSHIPS
- One or two paragraphs describing how the main elements cooperate.
- Focus on functional relationships, not implementation detail.

D) SCOPE-PRESERVING VARIATIONS
- One paragraph indicating that alternative configurations,
  arrangements, or implementations may be used.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Each paragraph must contain EXACTLY 2–3 sentences.
- One paragraph = one conceptual role.
- Use concise, controlled patent prose.
- Avoid narrative or explanatory exposition.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "includes," "comprises," "is configured to," "may," "can."
- Avoid: "must," "always," "only," "necessarily."
- Avoid evaluative terms such as:
  "better," "improved," "efficient," "optimal," "advanced."

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Use claim-style "wherein" clauses.
- Introduce reference numerals or figure references.
- Describe advantages, effects, or results.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Technical Solution text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention claims, figures, or embodiments explicitly.
- If a sentence resembles claim language, rewrite it at a higher level of abstraction.`,
    constraints: ["Direct link to Technical Problem","Explain cause-effect relationship","2-4 paragraphs"]
  },
  {
    sectionKey: 'advantageousEffects',
    aliases: ["advantageous_effects"],
    displayOrder: 9,
    label: 'Advantageous Effects',
    description: 'Advantageous Effects section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,
    requiresComponents: false,
    instruction: `ROLE: Patent Advantageous Effects Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "ADVANTAGEOUS EFFECTS OF THE INVENTION" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A MARKETING SECTION, RESULTS DISCUSSION, OR INVENTIVE STEP ARGUMENT.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Describe technical effects that may arise from the claimed features.
- Link effects causally to structural or functional aspects of Claim 1.
- Support claim interpretation without asserting superiority or novelty.
- Provide examiner-readable technical effects, not persuasive argument.

THIS SECTION MUST BE CONSISTENT WITH CLAIM 1
BUT MUST NOT ARGUE INVENTIVE STEP OR COMPARATIVE SUPERIORITY.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Claim 1 ONLY to identify features that can reasonably produce technical effects.
2. Every effect described MUST be traceable to one or more Claim 1 features.
3. Do NOT introduce effects that rely on features not present in Claim 1.
4. Do NOT use Normalized Data to add new advantages not inferable from Claim 1.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, technical patent language.
2. Do NOT use comparative language against prior art.
3. Do NOT assert novelty, inventiveness, or superiority.
4. Do NOT describe commercial, economic, or user-experience benefits.
5. Avoid absolute statements; effects must be conditional and contextual.

────────────────────────────────────────
EFFECT-CAUSATION RULE (CRITICAL)
────────────────────────────────────────
Each advantageous effect MUST:
- Be framed as a technical effect (not a benefit or result).
- Be causally linked to a specific claimed feature or interaction.
- Be expressed as something that "may be achieved" or "can result".

Do NOT describe effects in isolation from technical structure.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Advantageous Effects section using the following structure ONLY:

- Each paragraph describes ONE technical effect.
- Each effect must be described independently.
- Effects may relate to:
  (a) technical operation,
  (b) system behavior,
  (c) functional interaction,
  (d) technical reliability or configurational flexibility.

Do NOT group multiple effects into a single paragraph.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Each paragraph MUST contain EXACTLY 2 sentences.
- Sentence 1: Identify the technical effect in neutral terms.
- Sentence 2: State the technical feature or interaction of Claim 1
  from which the effect may arise.
- Do NOT include examples, data, or explanations beyond this.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "may provide", "can enable", "may allow", "can facilitate".
- Avoid: "improves", "enhances", "optimizes", "better", "more efficient".
- Avoid: "therefore", "thus", "as a result".

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Compare against prior art or conventional systems.
- Mention "advantages over existing solutions".
- Mention performance metrics, benchmarks, or results.
- Mention embodiments, figures, or reference numerals.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Advantageous Effects text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention claims, figures, embodiments, or prior art explicitly.
- If an effect cannot be causally tied to Claim 1, it MUST be omitted.`,
    constraints: ["Specific, measurable advantages","Supported by specification","No marketing language","3-6 advantages"]
  },
  {
    sectionKey: 'briefDescriptionOfDrawings',
    aliases: ["brief_description_of_drawings","drawings","figures","brief_drawings"],
    displayOrder: 10,
    label: 'Brief Description of the Drawings',
    description: 'Brief Description of the Drawings section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: true,
    requiresClaims: false,
    requiresComponents: true,
    instruction: `ROLE: Patent Drawings Description Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "BRIEF DESCRIPTION OF THE DRAWINGS" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A DETAILED DESCRIPTION, FIGURE ANALYSIS, OR EXPLANATORY NARRATIVE.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Provide a concise, factual listing of the drawings included in the application.
- Identify each figure by number and a brief neutral description.
- Enable reference to figures elsewhere in the specification without interpretation.

THIS SECTION MUST DESCRIBE ONLY WHAT EACH FIGURE REPRESENTS,
NOT HOW IT FUNCTIONS OR WHY IT IS INCLUDED.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- A list of figures as injected context (figure numbers and titles only).

RULES FOR USING INPUTS:
1. Use ONLY the provided figure numbers and figure identifiers.
2. Do NOT invent, renumber, rename, or omit any figure.
3. Do NOT infer content beyond what is implied by the figure title.
4. Preserve the figure order exactly as provided.

If no figures are provided, this section MUST NOT be generated.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, factual patent language.
2. Do NOT describe operation, function, or interaction.
3. Do NOT introduce technical interpretation.
4. Do NOT reference claim elements or embodiments.
5. Avoid adjectives or evaluative terms.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the section as a sequence of figure descriptions only.

FOR EACH FIGURE:
- Start a new sentence.
- Identify the figure number.
- Provide a brief, neutral description of what the figure represents.

Use standard phrasing such as:
"FIG. 1 is a schematic view of …"
"FIG. 2 is a block diagram of …"
"FIG. 3 is a flow diagram illustrating …"

Do NOT vary sentence structure beyond this pattern.

────────────────────────────────────────
FORMAT AND LENGTH RULES (NON-NEGOTIABLE)
────────────────────────────────────────
- Each figure description must be a SINGLE sentence.
- Do NOT combine multiple figures into one sentence.
- Do NOT include paragraph breaks within a figure description.
- Do NOT include numbering other than the FIG. X reference.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "is a schematic view of", "is a block diagram of", "is a flow diagram illustrating".
- Avoid: "shows", "illustrates", "depicts", "represents", "demonstrates".
- Avoid: "detailed", "preferred", "example", "advantageous".

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Reference reference numerals.
- Reference claim elements.
- Reference embodiments.
- Explain relationships between figures.
- Add introductory or concluding sentences.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Brief Description of the Drawings text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention claims, embodiments, or prior art.
- Do NOT add text before the first figure or after the last figure.`,
    constraints: ["One sentence per figure","Specify view type","Briefly describe content","Use consistent formatting"]
  },
  {
    sectionKey: 'detailedDescription',
    aliases: ["detailed_description","detailedDescriptionOfInvention","detailed_description_of_invention"],
    displayOrder: 11,
    label: 'Detailed Description',
    description: 'Detailed Description section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: true,
    requiresClaims: true,
    requiresComponents: true,
    instruction: `ROLE: Patent Detailed Description Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "DETAILED DESCRIPTION OF THE INVENTION" OF A PATENT SPECIFICATION.
THIS IS NOT A RESEARCH PAPER, TECHNICAL MANUAL, DESIGN DOCUMENT, OR MARKETING MATERIAL.

────────────────────────────────────────
PROMPT PRIORITY (AUTHORITATIVE ORDER)
────────────────────────────────────────
1) BASE PROMPT (this section)
2) TOP-UP PROMPT (jurisdiction, if any)
3) USER INSTRUCTIONS (only if consistent with BASE and TOP-UP)

If any instruction conflicts with BASE or TOP-UP rules, IGNORE the conflicting instruction.

────────────────────────────────────────
CORE LEGAL PURPOSE
────────────────────────────────────────
- Provide written description and enablement sufficient to support the claims.
- Disclose the invention with minimal but complete technical detail.
- Preserve claim flexibility by avoiding unnecessary limitation.

────────────────────────────────────────
INPUTS YOU WILL RECEIVE
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)
- Optional injected context (figures, components, numerals) if enabled

All injected content is authoritative.
Do NOT invent missing elements or details.

────────────────────────────────────────
CLAIM SUPPORT CONSTRAINT (CRITICAL)
────────────────────────────────────────
Claims may be used ONLY for semantic alignment and coverage.

RULES FOR USING CLAIM 1:
1. Identify the key technical elements and functional relationships expressed in Claim 1.
2. Ensure each such element and relationship has descriptive support in this section.
3. Use Claim 1 terminology as canonical terminology throughout this section.
4. Do NOT restate, paraphrase, or mirror claim sentences.
5. Do NOT follow claim numbering, "wherein" structure, or claim sentence rhythm.
6. Do NOT introduce technical concepts not reasonably inferable from Claim 1
   and the Normalized Data.

────────────────────────────────────────
TERMINOLOGY DISCIPLINE
────────────────────────────────────────
- Use one canonical name per element across the entire section.
- Do NOT replace Claim 1 terms with synonyms.
- If Claim 1 uses a term, that term must be used consistently.

────────────────────────────────────────
MANDATORY OUTPUT FORMAT
────────────────────────────────────────
- Output MUST consist of multiple paragraphs separated by a BLANK LINE.
- Each paragraph MUST contain EXACTLY TWO sentences.
- Paragraph boundaries MUST be preserved using two newline characters.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- ONE paragraph = ONE disclosure unit only.

A disclosure unit may be:
(a) one system or apparatus element,
(b) one sub-component,
(c) one functional interaction between elements,
(d) one optional variation supporting claim scope.

SENTENCE RULES:
- Sentence 1: Identify the element or interaction using canonical terminology.
- Sentence 2: State ONLY its structural or functional role, then STOP.
- If additional detail is needed, create a NEW paragraph.

────────────────────────────────────────
PERMITTED LEVEL OF TECHNICAL DETAIL
────────────────────────────────────────
- Functional "configured to" descriptions are permitted.
- Interface-level interactions (inputs, outputs, cooperation) are permitted.
- Internal algorithms, control logic, decision trees, or computation steps
  are NOT permitted unless explicitly required by Claim 1.

────────────────────────────────────────
FIGURE REFERENCE RULE
────────────────────────────────────────
Figures may be referenced ONLY as parentheticals:
- (FIG. X) or (see FIG. X)

Do NOT narrate or describe figures.

────────────────────────────────────────
CONTENT SEQUENCE (STRICT)
────────────────────────────────────────
Draft paragraphs in the following order ONLY:

A) One system overview paragraph (components only, no interactions).
B) One paragraph for each major element of Claim 1.
C) Up to FOUR paragraphs describing claim-relevant interactions.
D) Up to SIX paragraphs describing optional variations that preserve scope.
E) One best-mode paragraph ONLY if explicitly required by jurisdiction.

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Explain motivations, design reasoning, benefits, or results.
- Use evaluative or comparative language.
- Introduce new components, figures, or numerals not provided.

────────────────────────────────────────
SELF-CHECK (INTERNAL ONLY)
────────────────────────────────────────
Before finalizing, ensure:
- Every major Claim 1 element appears at least once.
- Every Claim 1 functional relationship has at least one interaction paragraph.
- No paragraph introduces unsupported subject matter.

Do NOT output the self-check.

────────────────────────────────────────
OUTPUT CONTROL
────────────────────────────────────────
Return ONLY a valid JSON object exactly matching this schema:
{ "detailedDescription": "..." }

Do NOT include any other keys.`,
    constraints: ["Enable skilled person to practice","Reference figures with numerals","Include multiple embodiments","Describe best mode"]
  },
  {
    sectionKey: 'bestMode',
    aliases: ["best_mode","bestMethod","best_method"],
    displayOrder: 12,
    label: 'Best Mode',
    description: 'Best Mode section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: true,
    requiresClaims: false,
    requiresComponents: true,
    instruction: `ROLE: Patent Best Mode Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "BEST MODE / BEST METHOD" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A DESIGN RATIONALE, OPTIMIZATION DISCUSSION, OR PREFERRED EMBODIMENT SALES PITCH.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Disclose the best mode contemplated by the inventor for carrying out the claimed invention,
  to the extent required by applicable jurisdiction.
- Provide sufficient technical detail to satisfy best-mode disclosure obligations
  without narrowing claim scope.
- Describe a concrete implementation consistent with Claim 1.

THIS SECTION MUST BE CONSISTENT WITH CLAIM 1
AND MUST NOT INTRODUCE NEW SUBJECT MATTER.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)
- Optional injected context (figures/components) if enabled

RULES FOR USING INPUTS:
1. Use Claim 1 as the authoritative scope boundary.
2. Describe ONLY features and configurations reasonably supported by Claim 1.
3. Do NOT introduce new components, parameters, materials, or steps
   not inferable from Claim 1 and the Normalized Data.
4. Do NOT imply that the disclosed mode is the only mode.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, technical patent language.
2. Do NOT assert that this mode is optimal, superior, or preferred for all cases.
3. Do NOT explain why this mode was chosen.
4. Do NOT include performance data, results, or advantages.
5. Avoid absolute or limiting language.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Best Mode section using the following structure ONLY:

- Describe ONE concrete configuration or implementation
  for carrying out the claimed invention.
- The description must be specific enough to enable execution,
  but not so specific as to limit claim scope.
- The best mode must be presented as one contemplated mode,
  not as an exclusive or mandatory configuration.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of ONE OR TWO paragraphs only.
- Each paragraph MUST contain EXACTLY 2 sentences.
- One paragraph = one disclosure unit.
- Avoid narrative or explanatory exposition.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "may be implemented", "in one configuration", "can be carried out".
- Avoid: "best", "optimal", "most efficient", "preferred above all others".
- Avoid: "therefore", "thus", "as a result".

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Introduce embodiments not already supported by Claim 1.
- Add optional variations or design alternatives.
- Reference figures or reference numerals unless explicitly injected.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Best Mode / Best Method text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention claims, figures, embodiments explicitly, or prior art.
- If best mode disclosure is not required by jurisdiction,
  output a minimal compliant disclosure consistent with Claim 1.`,
    constraints: ["Disclose preferred embodiment","Include specific parameters","Do not obscure best mode"]
  },
  {
    sectionKey: 'industrialApplicability',
    aliases: ["industrial_applicability"],
    displayOrder: 13,
    label: 'Industrial Applicability',
    description: 'Industrial Applicability section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Industrial Applicability Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "INDUSTRIAL APPLICABILITY" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A COMMERCIAL USE CASE, MARKET ANALYSIS, OR ADVANTAGES SECTION.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- State that the claimed invention is capable of being made or used in industry.
- Identify general industrial fields or technical contexts of applicability.
- Satisfy statutory industrial applicability requirements
  without limiting claim scope.

THIS SECTION MUST CONFIRM APPLICABILITY,
NOT EXPLAIN BENEFITS OR PREFERRED USES.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Claim 1 ONLY to ensure the applicability statement
   is consistent with the claimed subject matter.
2. Use Normalized Data ONLY to identify broad industrial domains.
3. Do NOT introduce specific implementations, configurations, or embodiments.
4. Do NOT narrow applicability to a single industry unless unavoidable.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Do NOT assert commercial value, market demand, or economic advantage.
3. Do NOT describe technical advantages, effects, or results.
4. Do NOT imply exclusivity or optimality of use.
5. Avoid speculative or promotional language.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Industrial Applicability section using the following structure ONLY:

- State that the invention is capable of industrial manufacture and/or use.
- Identify one or more broad industrial or technical fields
  in which the invention may be applied.
- Keep the description general and non-limiting.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of ONE paragraph only.
- The paragraph MUST contain EXACTLY 2 sentences.
- Maintain concise, controlled patent prose.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer formulations such as:
  "The invention is capable of being made and used in industry."
  "The invention may be applied in various industrial contexts including…"
- Prefer: "may", "can", "is capable of".
- Avoid: "will", "ensures", "guarantees".
- Avoid evaluative or comparative terms.

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Mention advantages, effects, or performance.
- Mention specific products, markets, or end users.
- Mention claims, figures, embodiments, or prior art.
- Include examples, scenarios, or explanatory detail.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Industrial Applicability text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT reference claims, figures, embodiments, or the invention explicitly.
- If the paragraph narrows scope beyond general applicability,
  it MUST be rewritten more broadly.`,
    constraints: ["Identify specific industries","Describe practical applications","1-2 paragraphs"]
  },
  {
    sectionKey: 'claims',
    aliases: [],
    displayOrder: 14,
    label: 'Claims',
    description: 'Claims section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: true,
    instruction: `ROLE: Patent Claim Drafter (Attorney-Grade).

YOU ARE DRAFTING THE CLAIMS OF A PATENT SPECIFICATION.
THIS IS NOT A SUMMARY, DESCRIPTION, OR LEGAL ARGUMENT.
THE CLAIMS DEFINE THE LEGAL BOUNDARIES AND MUST BE DRAFTED WITH MAXIMUM DISCIPLINE.

────────────────────────────────────────
PROMPT PRIORITY (AUTHORITATIVE ORDER)
────────────────────────────────────────
1) BASE PROMPT (this section)
2) TOP-UP PROMPT (jurisdiction, if any)
3) USER INSTRUCTIONS (only if consistent with BASE and TOP-UP)

If any instruction conflicts with BASE or TOP-UP rules, IGNORE the conflicting instruction.

────────────────────────────────────────
CORE LEGAL PURPOSE
────────────────────────────────────────
- Draft clear, enforceable patent claims defining the invention.
- Use formal claim language with precise legal structure.
- Provide one independent claim and an appropriate set of dependent claims.
- Preserve breadth while maintaining clarity and support.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive invention context and, if provided, component names and reference numerals as read-only facts.

RULES:
1. Use ONLY the provided context to determine claim elements and relationships.
2. Do NOT invent components, steps, parameters, or features.
3. Use one canonical term per element throughout the claim set.
4. If reference numerals are provided, they may be used in parentheses but must not be invented.

────────────────────────────────────────
MANDATORY CLAIM DRAFTING DISCIPLINE
────────────────────────────────────────
1. Each claim MUST be written as a SINGLE sentence.
2. Use open-ended transitional phrases such as "comprising" unless Top-Up requires otherwise.
3. Maintain strict antecedent basis:
   - Introduce elements with "a" or "an".
   - Refer back using "the" with identical terminology.
4. Avoid subjective or relative terms unless structurally defined.
5. Do NOT include advantages, results, motivations, or explanations.

────────────────────────────────────────
CLAIM STRUCTURE AND FORMATTING (CRITICAL)
────────────────────────────────────────
Claims MUST be formatted as follows:

- Claims are numbered using Arabic numerals: 1., 2., 3., etc.
- Each claim appears on its own line.
- Each claim is a SINGLE sentence.

INTERNAL STRUCTURE OF EACH CLAIM:
- Within a claim, list claim ELEMENTS as lettered clauses:
  (a), (b), (c), etc.
- Each lettered clause MUST:
  - Appear on a NEW LINE
  - Be indented relative to the claim number
  - Represent a claim ELEMENT or limitation
- All lettered clauses together MUST form one continuous sentence.

EXAMPLE FORMAT (ILLUSTRATIVE ONLY — DO NOT COPY CONTENT):
1. A system comprising:
   (a) a first element configured to ...;
   (b) a second element coupled to the first element and configured to ...;
   (c) a third element configured to ....

────────────────────────────────────────
CLAIM SET STRUCTURE (STRICT)
────────────────────────────────────────
A) CLAIM 1 (INDEPENDENT)
- Draft ONE independent claim defining the invention in its broadest supported form.
- Choose the correct claim category (system, apparatus, method, computer-readable medium) based on context.
- Include only essential elements and functional relationships.
- Structure Claim 1 using lettered claim elements (a), (b), (c), etc.

B) DEPENDENT CLAIMS
- Draft dependent claims numbered sequentially (2, 3, 4, …).
- Each dependent claim must:
  - Refer to a previous claim by number.
  - Add exactly ONE additional limitation.
- Dependent claims may also use lettered sub-clauses if clarity requires.

────────────────────────────────────────
WORDING RULES
────────────────────────────────────────
- Use "configured to", "operative to", or "arranged to" for functional language.
- Avoid means-plus-function language unless explicitly required.
- Avoid implementation detail unless necessary for support.

────────────────────────────────────────
INTERNAL SELF-CHECK (DO NOT OUTPUT)
────────────────────────────────────────
Verify that:
1. Each claim is a single sentence.
2. Lettered clauses are elements, not separate sentences.
3. Antecedent basis is correct across lettered clauses.
4. No element is introduced without support.
5. Terminology is consistent across all claims.

Do NOT output this checklist.

────────────────────────────────────────
OUTPUT CONTROL
────────────────────────────────────────
Return ONLY a valid JSON object exactly matching this schema:
{ "claims": "..." }

Do NOT include any other keys.`,
    constraints: ["Single sentence per claim","Proper antecedent basis","Clear transition phrases","10-20 claims typical","Independent + dependent structure"]
  },
  {
    sectionKey: 'abstract',
    aliases: [],
    displayOrder: 15,
    label: 'Abstract',
    description: 'Abstract section for patent specifications.',
    isRequired: true,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: true,
    requiresComponents: false,
    instruction: `ROLE: Patent Abstract Drafter (Attorney-Grade).

YOU ARE DRAFTING THE ABSTRACT OF A PATENT SPECIFICATION.
THIS IS NOT A RESEARCH ABSTRACT, EXECUTIVE SUMMARY, OR MARKETING DESCRIPTION.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Provide a concise technical disclosure of the invention.
- Enable quick technical understanding by examiners and search systems.
- Reflect the essence of Claim 1 without limiting claim scope.
- Comply with strict abstract drafting norms used in patent offices.

THIS SECTION MUST BE CONSISTENT WITH CLAIM 1 BUT MUST NOT MIRROR OR RESTATE CLAIM LANGUAGE.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You will receive:
- Normalized Data (read-only invention context)
- Claim 1 (frozen legal anchor)

RULES FOR USING INPUTS:
1. Use Normalized Data to maintain technical field context and terminology consistency.
2. Use Claim 1 ONLY as a semantic anchor to ensure coverage of essential elements.
3. Do NOT restate, paraphrase, or follow the sentence structure of Claim 1.
4. Do NOT introduce technical features not reasonably inferable from Claim 1.
5. Do NOT narrow the scope beyond what Claim 1 supports.

────────────────────────────────────────
MANDATORY PATENT DISCIPLINE
────────────────────────────────────────
1. Use neutral, formal patent language.
2. Do NOT imply novelty, superiority, or inventive step.
3. Do NOT describe advantages, results, or performance metrics.
4. Avoid promotional or evaluative language.
5. Avoid legal conclusions or examiner-directed argumentation.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the Abstract using the following structure ONLY:

A) TECHNICAL FIELD
- One sentence identifying the general technical field.

B) TECHNICAL SUBJECT MATTER
- One or two sentences identifying the general nature of the system, apparatus, or method.

C) CORE TECHNICAL CONCEPT
- One or two sentences describing the core technical concept and primary elements
  at a high level, consistent with Claim 1 terminology.

D) FUNCTIONAL OVERVIEW
- One or two sentences describing the primary functional relationship or operation
  without implementation detail.

────────────────────────────────────────
LENGTH AND FORM CONSTRAINTS
────────────────────────────────────────
- Total length must be concise and suitable for patent abstract requirements.
- Do NOT exceed jurisdiction-specific word limits (handled via Top-Up prompt).
- Write as a single continuous paragraph unless jurisdiction requires otherwise.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer: "includes," "comprises," "is configured to," "may," "can."
- Avoid: "must," "always," "only," "necessarily."
- Avoid comparative or evaluative terms such as:
  "better," "improved," "efficient," "optimal," "advanced."

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Use claim-style "wherein" clauses.
- Reference figures, reference numerals, or drawings.
- Describe embodiments explicitly.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Abstract text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT mention claims, figures, or embodiments explicitly.
- If a sentence resembles claim language, rewrite it at a higher level of abstraction.`,
    constraints: ["Maximum 150 words","Single paragraph","Include key figure reference","No claims or legal language"]
  },
  {
    sectionKey: 'listOfNumerals',
    aliases: ["list_of_numerals","numeralList","numeral_list","referenceNumerals","reference_numerals"],
    displayOrder: 16,
    label: 'List of Reference Numerals',
    description: 'List of Reference Numerals section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: true,
    instruction: `**Role:** Reference Numeral Cataloger.

**Task:** Generate a comprehensive list of reference numerals used in the specification.

**Format:**
- (100) - [Component Name]
- (101) - [Sub-component Name]`,
    constraints: ["List in numerical order","Use exact component names from specification","Include all numerals from drawings and description","Format: (XXX) - Component Name"]
  },
  {
    sectionKey: 'crossReference',
    aliases: ["cross_reference","crossReferences","cross_references","relatedApplications","related_applications"],
    displayOrder: 17,
    label: 'Cross-Reference to Related Applications',
    description: 'Cross-Reference to Related Applications section for patent specifications.',
    isRequired: false,
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false,
    instruction: `ROLE: Patent Cross-Reference Drafter (Attorney-Grade).

YOU ARE DRAFTING THE "CROSS-REFERENCE TO RELATED APPLICATIONS" SECTION
OF A PATENT SPECIFICATION.
THIS IS NOT A BACKGROUND SECTION, PRIOR ART DISCUSSION, OR PROCEDURAL HISTORY.

────────────────────────────────────────
CORE LEGAL PURPOSE OF THIS SECTION
────────────────────────────────────────
- Identify any related patent applications to which priority, benefit,
  or reference is claimed.
- Provide a formal legal cross-reference in compliance with patent office norms.
- Preserve priority rights without adding technical disclosure.

THIS SECTION IS PURELY LEGAL AND PROCEDURAL.
NO TECHNICAL CONTENT IS PERMITTED.

────────────────────────────────────────
INPUT DISCIPLINE (CRITICAL)
────────────────────────────────────────
You may receive:
- Related application data (application numbers, filing dates,
  jurisdictions, titles), if any.

RULES FOR USING INPUTS:
1. Use ONLY the provided related application data.
2. Do NOT invent, infer, or assume the existence of related applications.
3. Do NOT correct, expand, or reinterpret provided legal details.
4. Preserve application numbers, dates, and jurisdictions exactly as given.

If NO related application data is provided,
THIS SECTION MUST STILL BE GENERATED AS A FORMAL STATEMENT OF NON-CLAIM.

────────────────────────────────────────
MANDATORY LEGAL DISCIPLINE
────────────────────────────────────────
1. Use formal, neutral patent legal language.
2. Do NOT include technical description, background, or motivation.
3. Do NOT include opinions, explanations, or procedural commentary.
4. Do NOT reference claims, figures, embodiments, or subject matter.

────────────────────────────────────────
CONTENT STRUCTURE (STRICT)
────────────────────────────────────────
Draft the section using ONE of the following patterns ONLY:

PATTERN A — RELATED APPLICATIONS EXIST:
- State that the application claims priority to or benefit of
  one or more identified applications.
- Include:
  • application number,
  • filing date,
  • jurisdiction,
  • relationship (e.g., priority, continuation, divisional),
  exactly as provided.

PATTERN B — NO RELATED APPLICATIONS:
- State clearly that there are no related applications
  or that no priority is claimed.

Do NOT mix patterns.

────────────────────────────────────────
PARAGRAPH DISCIPLINE (NON-NEGOTIABLE)
────────────────────────────────────────
- Output MUST consist of ONE paragraph only.
- The paragraph MUST contain EXACTLY ONE sentence.
- Do NOT split into multiple sentences or clauses.

────────────────────────────────────────
LANGUAGE CONSTRAINTS
────────────────────────────────────────
- Prefer formal constructions such as:
  "This application claims priority to…"
  "This application claims the benefit of…"
  "This application does not claim priority to any related application."
- Avoid casual or explanatory phrasing.

────────────────────────────────────────
PROHIBITED CONTENT
────────────────────────────────────────
Do NOT:
- Mention technical subject matter.
- Mention reasons for claiming or not claiming priority.
- Mention prior art, background, or invention context.
- Mention claims, figures, embodiments, or advantages.

────────────────────────────────────────
OUTPUT RULES
────────────────────────────────────────
- Output ONLY the Cross-Reference to Related Applications text.
- Do NOT include headings, bullet points, numbering, or commentary.
- Do NOT add placeholders such as "if any".
- If no related application data is provided,
  output a formal non-claim statement.`,
    constraints: ["List applications chronologically","Include application numbers and filing dates","Specify relationship type clearly","Use proper legal terminology"]
  },
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
// STEP 2: SEED COUNTRY NAMES (Complete list of all jurisdictions)
// ============================================================================

// All supported country/jurisdiction names (30 total)
const ALL_COUNTRY_NAMES = [
  { code: 'AU', name: 'Australia', continent: 'Oceania' },
  { code: 'BD', name: 'Bangladesh', continent: 'Asia' },
  { code: 'BR', name: 'Brazil', continent: 'South America' },
  { code: 'CA', name: 'Canada', continent: 'North America' },
  { code: 'CH', name: 'Switzerland', continent: 'Europe' },
  { code: 'CN', name: 'China', continent: 'Asia' },
  { code: 'DE', name: 'Germany', continent: 'Europe' },
  { code: 'EP', name: 'European Patent Office', continent: 'Europe' },
  { code: 'ES', name: 'Spain', continent: 'Europe' },
  { code: 'EU', name: 'European Union', continent: 'Europe' },
  { code: 'FR', name: 'France', continent: 'Europe' },
  { code: 'IL', name: 'Israel', continent: 'Asia' },
  { code: 'IN', name: 'India', continent: 'Asia' },
  { code: 'IR', name: 'Iran', continent: 'Asia' },
  { code: 'JP', name: 'Japan', continent: 'Asia' },
  { code: 'KR', name: 'South Korea', continent: 'Asia' },
  { code: 'MX', name: 'Mexico', continent: 'North America' },
  { code: 'MY', name: 'Malaysia', continent: 'Asia' },
  { code: 'NZ', name: 'New Zealand', continent: 'Oceania' },
  { code: 'PCT', name: 'PCT International', continent: 'International' },
  { code: 'PK', name: 'Pakistan', continent: 'Asia' },
  { code: 'PL', name: 'Poland', continent: 'Europe' },
  { code: 'RU', name: 'Russia', continent: 'Europe' },
  { code: 'SA', name: 'Saudi Arabia', continent: 'Asia' },
  { code: 'SE', name: 'Sweden', continent: 'Europe' },
  { code: 'TW', name: 'Taiwan', continent: 'Asia' },
  { code: 'UAE', name: 'United Arab Emirates', continent: 'Asia' },
  { code: 'UK', name: 'United Kingdom', continent: 'Europe' },
  { code: 'US', name: 'United States of America', continent: 'North America' },
  { code: 'ZA', name: 'South Africa', continent: 'Africa' }
];

async function seedCountryNames() {
  printHeader('🌍 STEP 2: Seeding Country Names');

  // Use the complete hardcoded list (all 30 jurisdictions)
  const countryNames = ALL_COUNTRY_NAMES;
  console.log(`  📋 Seeding ${countryNames.length} country names...`);

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
// STEP 5: SEED COUNTRY PROFILES (only from dedicated JSON files)
// ============================================================================

async function seedCountryProfiles(systemUserId) {
  printHeader('📋 STEP 5: Seeding Country Profiles');

  // Only seed profiles from dedicated JSON files (AU, CA, IN, JP, PCT, US)
  const files = fs.readdirSync(COUNTRIES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && !f.includes('backup') && !f.includes('sample') && !f.startsWith('db-'));

  let created = 0, updated = 0, skipped = 0;

  console.log('  📂 Seeding countries with complete JSON configurations...');
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
  console.log('  💡 Only countries with complete JSON files are seeded.');
  console.log('     To add more, create [COUNTRY_CODE].json in Countries/ folder.');
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

