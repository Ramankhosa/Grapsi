/**
 * AI Review Service
 * 
 * Uses Gemini for comprehensive patent draft review:
 * - Cross-section consistency (claims vs description)
 * - Diagram-description alignment (PlantUML analysis)
 * - Missing features detection
 * - Section-wise recommendations
 */

import { llmGateway } from '@/lib/metering'
import crypto from 'crypto'

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified issue structure - reduces JSON errors from LLM output
 * 
 * Old format had 8 fields which caused frequent JSON parsing failures.
 * New format has 4 core fields + computed fields added after parsing.
 * 
 * LLM outputs: { s, t, title, fix }
 * We expand to: { id, sectionKey, sectionLabel, type, title, fix, ... }
 */
export interface AIReviewIssue {
  id: string
  sectionKey: string
  sectionLabel: string
  type: 'error' | 'warning' | 'suggestion'
  title: string
  fix: string // Combined fix instruction (replaces description + suggestion + fixPrompt)
  // Legacy fields kept for backward compatibility (computed from 'fix')
  description: string
  suggestion: string
  fixPrompt: string
  severity: number // Default 3, computed from type (E=4, W=3, S=2)
  category: string // Category for issue classification (e.g., 'diagram', 'claims', 'general', etc.)
}

export interface AIReviewResult {
  success: boolean
  issues: AIReviewIssue[]
  summary: {
    totalIssues: number
    errors: number
    warnings: number
    suggestions: number
    overallScore: number // 0-100
    recommendation: string
  }
  reviewedAt: string
  tokensUsed?: number
  error?: string
}

export interface ReviewContext {
  draft: Record<string, string>
  figures: Array<{
    figureNo: number
    title: string
    plantuml: string
  }>
  /** Sketches from figure planner - include description to prevent false "missing figure" errors */
  sketches?: Array<{
    figureNo: number
    title: string
    description: string
    isIncluded: boolean // Whether it's in the final figure sequence
  }>
  jurisdiction: string
  inventionTitle?: string
  components?: Array<{ name: string; numeral: string }>
  /** Section validation limits from CountrySectionValidation table */
  sectionLimits?: Array<{
    sectionKey: string
    maxWords?: number
    minWords?: number
    recommendedWords?: number
    maxChars?: number
    maxCount?: number
    maxIndependent?: number
    wordLimitMessage?: string
    charLimitMessage?: string
    legalReference?: string
  }>
  /** Cross-section validation rules from CountryCrossValidation table */
  crossValidations?: Array<{
    ruleKey: string
    sourceSection: string
    targetSection: string
    ruleName: string
    description: string
    severity: string
    validationLogic?: string
  }>
}

// ============================================================================
// Section Labels for Display
// ============================================================================

const SECTION_LABELS: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  field: 'Field of Invention',
  fieldOfInvention: 'Field of Invention',
  background: 'Background',
  technicalProblem: 'Technical Problem',
  objectsOfInvention: 'Objects of Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method / Mode',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals'
}

// ============================================================================
// Main Review Function
// ============================================================================

/**
 * Run comprehensive AI review on a patent draft
 * Uses AI for holistic analysis - trusts the AI to catch all relevant issues
 */
export async function runAIReview(
  context: ReviewContext,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<AIReviewResult> {
  try {
    const { draft, figures, jurisdiction, inventionTitle, components, sketches, sectionLimits, crossValidations } = context
    
    // Build comprehensive review prompt with all context
    const prompt = buildReviewPrompt(
      draft, 
      figures, 
      jurisdiction, 
      inventionTitle, 
      components,
      sketches,
      sectionLimits,
      crossValidations
    )
    
    // Use LLM for review - uses admin-configured model via DRAFT_REVIEW stage
    // The review task requires strong reasoning and structured JSON output
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'DRAFT_REVIEW', // Use stage config for admin-configured model/limits
        prompt,
        parameters: {
          tenantId,
          purpose: 'ai_draft_review',
          temperature: 0.3, // Low temperature for consistent, analytical responses
          maxOutputTokens: 8000 // Higher limit for comprehensive review output
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          purpose: 'ai_draft_review',
          jurisdiction,
          sectionsReviewed: Object.keys(draft).length,
          figuresReviewed: figures.length
        }
      }
    )

    if (!result.success || !result.response) {
      return {
        success: false,
        issues: [],
        summary: {
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          overallScore: 75, // Minimum baseline even on failure
          recommendation: 'Review failed - please try again'
        },
        reviewedAt: new Date().toISOString(),
        error: result.error?.message || 'AI review failed'
      }
    }

    // Parse the review response
    const reviewData = parseReviewResponse(result.response.output)
    
    return {
      success: true,
      issues: reviewData.issues,
      summary: reviewData.summary,
      reviewedAt: new Date().toISOString(),
      tokensUsed: result.response.outputTokens
    }
  } catch (error) {
    console.error('AI Review error:', error)
    return {
      success: false,
      issues: [],
      summary: {
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        suggestions: 0,
        overallScore: 75, // Minimum baseline even on failure
        recommendation: 'Review failed due to an error'
      },
      reviewedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildReviewPrompt(
  draft: Record<string, string>,
  figures: Array<{ figureNo: number; title: string; plantuml: string }>,
  jurisdiction: string,
  inventionTitle?: string,
  components?: Array<{ name: string; numeral: string }>,
  sketches?: Array<{ figureNo: number; title: string; description: string; isIncluded: boolean }>,
  sectionLimits?: Array<{ sectionKey: string; maxWords?: number; minWords?: number; recommendedWords?: number; maxChars?: number; maxCount?: number; maxIndependent?: number; wordLimitMessage?: string; charLimitMessage?: string; legalReference?: string }>,
  crossValidations?: Array<{ ruleKey: string; sourceSection: string; targetSection: string; ruleName: string; description: string; severity: string; validationLogic?: string }>
): string {
  // Build sections text - increased limit to 15000 chars per section for comprehensive review
  // Critical sections like claims and detailedDescription need full content for proper analysis
  const sectionsText = Object.entries(draft)
    .filter(([_, content]) => content && content.trim().length > 0)
    .map(([key, content]) => {
      const maxLen = ['claims', 'detailedDescription', 'summary'].includes(key) ? 20000 : 10000
      const truncated = content.length > maxLen
      return `### ${SECTION_LABELS[key] || key}\n${content.substring(0, maxLen)}${truncated ? `\n\n[Note: Section continues for ${content.length - maxLen} more characters. Review the portion shown above.]` : ''}`
    })
    .join('\n\n')

  // Build comprehensive figures text with PlantUML and extracted elements
  let figuresText = 'No figures provided'
  if (figures.length > 0) {
    const figureDetails = figures.map(f => {
      // Extract components and arrows from PlantUML
      const componentMatches = f.plantuml.match(/(?:rectangle|component|node|database|actor|usecase|storage|cloud|folder|frame|package)\s+["']?([^"'\[\]{}]+)["']?\s*(?:as\s+(\w+))?/gi) || []
      const arrowMatches = f.plantuml.match(/(\w+)\s*(?:-->|->|<--|<-|--|\.\.>|\.\.)\s*(\w+)/gi) || []
      const numeralMatches = f.plantuml.match(/\((\d{2,3})\)/g) || []
      
      return `### Figure ${f.figureNo}: ${f.title}

**PlantUML Source Code:**
\`\`\`plantuml
${f.plantuml}
\`\`\`

**Extracted Elements from Diagram:**
- Components/Blocks: ${componentMatches.length > 0 ? componentMatches.join(', ') : 'None detected'}
- Connections/Flows: ${arrowMatches.length > 0 ? arrowMatches.slice(0, 10).join(', ') : 'None detected'}
- Reference Numerals: ${numeralMatches.length > 0 ? Array.from(new Set(numeralMatches)).join(', ') : 'None detected'}`
    }).join('\n\n')

    figuresText = `**DIAGRAM FIGURES (PlantUML Code):**
These ${figures.length} diagram(s) are provided as PlantUML source code.
The PlantUML code defines the structure, components, and relationships in each figure.
Analyze the code to understand what each diagram depicts.

${figureDetails}`
  }

  // Build sketches text - these are REAL figures but without PlantUML (images)
  let sketchesText = ''
  if (sketches && sketches.length > 0) {
    const sketchDetails = sketches.map(s => 
      `- **FIG. ${s.figureNo}**: "${s.title}" — ${s.description || 'Hand-drawn sketch/illustration'}`
    ).join('\n')
    sketchesText = `

═══════════════════════════════════════════════════════════════════════════════
SKETCH FIGURES (Image-based - No Code Provided)
═══════════════════════════════════════════════════════════════════════════════
⚠️ **CRITICAL:** The following figures are REAL figures included in the patent specification.
They are hand-drawn sketches or uploaded images, NOT PlantUML diagrams.

**Why no code is provided:** These are raster images (JPG/PNG), not text-based diagrams.
To save tokens, we provide only their metadata (title, description, position).

**DO NOT FLAG THESE AS MISSING FIGURES.** They exist in the patent and will be rendered properly.
When the draft references these figure numbers, they ARE valid references.

${sketchDetails}

**Summary of ALL Figures in Patent:**
${figures.length > 0 ? `- Diagrams (with PlantUML): FIG. ${figures.map(f => f.figureNo).join(', FIG. ')}` : '- No PlantUML diagrams'}
${sketches.length > 0 ? `- Sketches (image-based): FIG. ${sketches.map(s => s.figureNo).join(', FIG. ')}` : '- No sketches'}
- Total figures in patent: ${figures.length + sketches.length}`
  }

  // Build section limits text for jurisdiction-specific validation
  let sectionLimitsText = ''
  if (sectionLimits && sectionLimits.length > 0) {
    const limitsDetails = sectionLimits.map(l => {
      const limits: string[] = []
      if (l.maxWords) limits.push(`max ${l.maxWords} words`)
      if (l.minWords) limits.push(`min ${l.minWords} words`)
      if (l.recommendedWords) limits.push(`recommended ${l.recommendedWords} words`)
      if (l.maxChars) limits.push(`max ${l.maxChars} characters`)
      if (l.maxCount) limits.push(`max ${l.maxCount} claims`)
      if (l.maxIndependent) limits.push(`max ${l.maxIndependent} independent claims`)
      const message = l.wordLimitMessage || l.charLimitMessage || ''
      const ref = l.legalReference ? ` (${l.legalReference})` : ''
      return `- ${SECTION_LABELS[l.sectionKey] || l.sectionKey}: ${limits.join(', ')}${message ? ` - ${message}` : ''}${ref}`
    }).join('\n')
    sectionLimitsText = `

═══════════════════════════════════════════════════════════════════════════════
SECTION LIMITS (${jurisdiction} Jurisdiction Requirements)
═══════════════════════════════════════════════════════════════════════════════
Check if sections exceed these official limits:

${limitsDetails}

⚠️ Flag any sections that exceed their limits as errors with specific counts.`
  }

  // Build cross-validation rules text
  let crossValidationsText = ''
  if (crossValidations && crossValidations.length > 0) {
    const validationDetails = crossValidations.map(cv => 
      `- [${cv.severity.toUpperCase()}] ${cv.ruleName}: ${cv.description} (${cv.sourceSection} → ${cv.targetSection})`
    ).join('\n')
    crossValidationsText = `

═══════════════════════════════════════════════════════════════════════════════
CROSS-SECTION VALIDATION RULES (${jurisdiction} Jurisdiction)
═══════════════════════════════════════════════════════════════════════════════
These are jurisdiction-specific consistency checks:

${validationDetails}

⚠️ Check each rule and flag violations. For consistency issues (e.g., claim feature missing in description),
set sectionKey to the SECTION THAT NEEDS THE FIX (usually description), not the source section (claims).`
  }

  // Build components reference with grouping
  let componentsText = 'No components defined'
  if (components && components.length > 0) {
    const sorted = [...components].sort((a, b) => parseInt(a.numeral) - parseInt(b.numeral))
    componentsText = sorted.map(c => `- ${c.name} (${c.numeral})`).join('\n')
  }

  // Special handling for REFERENCE (multi-jurisdiction base draft)
  const isReferenceDraft = jurisdiction.toUpperCase() === 'REFERENCE'
  const jurisdictionContext = isReferenceDraft
    ? `REFERENCE (Multi-Jurisdiction Base Draft)

**SPECIAL CONTEXT:** This is a REFERENCE draft - a country-neutral master document that will be translated/adapted for multiple specific jurisdictions. Review it with extra scrutiny for:
- Universal clarity that translates well across languages
- No country-specific legal language that wouldn't apply universally
- Complete technical disclosure that serves as source for all country versions
- Consistent reference numeral usage for translation accuracy
- Clear, unambiguous language that avoids idioms or region-specific terms`
    : jurisdiction

  return `You are a senior patent examiner and technical reviewer. Perform a comprehensive review of this patent draft for ${jurisdictionContext} jurisdiction.

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Title: ${inventionTitle || 'Not specified'}
Jurisdiction: ${isReferenceDraft ? 'REFERENCE (Multi-Jurisdiction Base)' : jurisdiction}

DECLARED COMPONENTS WITH REFERENCE NUMERALS:
${componentsText}

═══════════════════════════════════════════════════════════════════════════════
DRAFT SECTIONS
═══════════════════════════════════════════════════════════════════════════════
${sectionsText}

═══════════════════════════════════════════════════════════════════════════════
PATENT FIGURES (Diagrams + Sketches)
═══════════════════════════════════════════════════════════════════════════════
${figuresText}
${sketchesText}

**FIGURE VALIDATION NOTE:** When reviewing figure references in the draft, check against
BOTH the PlantUML diagrams above AND the sketch figures listed. A reference to "FIG. X"
is valid if X appears in either the diagrams section OR the sketches section.
${sectionLimitsText}
${crossValidationsText}

═══════════════════════════════════════════════════════════════════════════════
REVIEW INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════

Analyze the draft for the following issues:

1. **CLAIMS vs DESCRIPTION CONSISTENCY**
   - Every feature in claims MUST be supported in detailed description
   - Check if claim limitations are properly disclosed
   - Identify any claim features missing from description

2. **DIAGRAM-DESCRIPTION ALIGNMENT** (Analyze PlantUML code to understand diagrams)
   - Compare PlantUML diagram structure with Brief Description of Drawings
   - Verify all reference numerals in PlantUML code appear in description text
   - Check if components shown in PlantUML match declared components above
   - Identify any diagram elements not explained in Detailed Description
   - Verify figure captions accurately describe what PlantUML shows

3. **COMPLETENESS CHECKS**
   - Are all declared components (above) mentioned and explained?
   - Does summary accurately reflect the claims?
   - Is the abstract within typical limits (150 words)?
   - Are reference numerals used consistently throughout?

4. **LEGAL/FORMAL ISSUES**
   - Claims properly numbered and dependent claims reference correctly
   - Independent claims are self-contained
   - No indefinite language without proper basis
   - Proper antecedent basis in claims

5. **CLARITY & QUALITY**
   - Ambiguous or unclear passages
   - Redundant content between sections
   - Technical accuracy concerns
${sectionLimits && sectionLimits.length > 0 ? `
6. **SECTION LENGTH LIMITS** (CRITICAL - Check against limits above)
   - Review each section against the jurisdiction-specific limits provided
   - Flag sections exceeding word/character/claim count limits as ERRORS
   - Note: For claims, check both total count AND independent claim count
` : ''}
${crossValidations && crossValidations.length > 0 ? `
7. **CROSS-SECTION CONSISTENCY** (Check rules above)
   - Apply each cross-validation rule listed above
   - For issues like "claim feature missing in description", set sectionKey to 'detailedDescription' (the fix target), NOT 'claims' (the source)
   - The fixPrompt should instruct how to add/modify the TARGET section
` : ''}
${isReferenceDraft ? `
8. **REFERENCE DRAFT - TRANSLATION READINESS** (CRITICAL for multi-jurisdiction)
   - **Language Neutrality:** Flag any country-specific legal phrases, idioms, or terms that won't translate well
   - **Universal Terminology:** Ensure technical terms are internationally recognized (not US/UK colloquialisms)
   - **Completeness for All Jurisdictions:** Check if all superset sections are properly populated
   - **Reference Numeral Consistency:** Extra strict checking - numerals must be 100% consistent for translation
   - **Unambiguous Antecedents:** No pronouns without clear antecedents (translation breaks with ambiguity)
   - **Sentence Structure:** Flag overly complex sentences that would translate poorly
   - **Cultural Neutrality:** No region-specific examples or analogies
` : ''}
═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT - SIMPLIFIED JSON (4 fields per issue)
═══════════════════════════════════════════════════════════════════════════════

Return ONLY a JSON object with this EXACT structure:

{
  "issues": [
    {"s": "claims", "t": "E", "title": "Antecedent basis error in Claim 2", "fix": "Change 'the processor' to 'a processor' in Claim 2 since this is the first mention."},
    {"s": "detailedDescription", "t": "W", "title": "Missing component 104", "fix": "Add paragraph after data flow section describing storage module (104)."}
  ],
  "score": 85,
  "summary": "Good draft with 2 issues to fix before filing."
}

FIELD DEFINITIONS:
- "s": Section key (claims, detailedDescription, abstract, briefDescriptionOfDrawings, etc.)
- "t": Type - MUST be exactly one of: "E" (error), "W" (warning), "S" (suggestion)
- "title": Brief issue title (max 10 words)
- "fix": Complete fix instruction that a smaller LLM can follow WITHOUT any other context
- "score": Number from 75-100 (minimum 75, perfect is 100)
- "summary": One sentence overall assessment

═══════════════════════════════════════════════════════════════════════════════
SCORING (75-100 range)
═══════════════════════════════════════════════════════════════════════════════
- 75 = Has issues needing attention
- 85 = Good draft, minor fixes
- 95 = Excellent, polish only
- 100 = Perfect, no issues

Score formula: Start at 100, subtract ~4 per error, ~1.5 per warning, ~0.5 per suggestion. Minimum 75.

═══════════════════════════════════════════════════════════════════════════════
FIX FIELD RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
The "fix" field will be sent to a DIFFERENT LLM with NO context. It MUST be:
✓ Self-contained - Include ALL necessary context
✓ Specific - Quote exact text that needs changing
✓ Actionable - Give concrete steps

BAD: "Fix the antecedent basis issue"
GOOD: "In Claim 2, change 'the processor' to 'a processor' since this is the first mention."

BAD: "Add missing component"
GOOD: "After '...data flow between modules.' add: 'The storage module (104) comprises non-volatile memory for user preferences.'"

═══════════════════════════════════════════════════════════════════════════════
JSON RULES (MUST FOLLOW)
═══════════════════════════════════════════════════════════════════════════════
⚠️ Output RAW JSON only - NO markdown, NO \`\`\`json\`\`\` fences
⚠️ Start with { and end with }
⚠️ Use \\" for quotes inside strings, \\n for newlines
⚠️ Commas between array elements, NO trailing commas
⚠️ Maximum 5 issues - if more exist, report the 5 most critical
⚠️ Keep "fix" under 200 characters when possible
⚠️ If unsure, output FEWER issues rather than risk JSON errors

EXAMPLE OUTPUT (copy this structure exactly):
{"issues":[{"s":"claims","t":"E","title":"Missing antecedent","fix":"In Claim 2, change 'the unit' to 'a unit'."}],"score":90,"summary":"Good draft, one fix needed."}`
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Attempt to repair common JSON issues from LLM output
 */
function repairJSON(text: string): string {
  let repaired = text

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1')

  // Add missing commas between array elements (object followed by object)
  repaired = repaired.replace(/\}(\s*)\{/g, '},$1{')

  // Add missing commas between string and object in array
  repaired = repaired.replace(/"(\s*)\{/g, '",$1{')

  // Fix unescaped newlines inside strings (common in fixPrompt fields)
  // This is tricky - we need to find strings and escape newlines within them
  repaired = repaired.replace(/"([^"]*?)(\r?\n)([^"]*?)"/g, (match, before, nl, after) => {
    // Only fix if it looks like it's inside a value (not a complete string)
    if (before.includes(':') || after.includes(':')) {
      return match // Likely spans multiple fields, don't touch
    }
    return `"${before}\\n${after}"`
  })

  // Fix control characters that break JSON parsing
  repaired = repaired.replace(/[\x00-\x1F\x7F]/g, (char) => {
    if (char === '\n') return '\\n'
    if (char === '\r') return '\\r'
    if (char === '\t') return '\\t'
    return '' // Remove other control chars
  })

  return repaired
}

/**
 * Map simplified type codes to full type names
 */
function mapTypeCode(t: string): 'error' | 'warning' | 'suggestion' {
  const code = (t || '').toUpperCase().trim()
  if (code === 'E' || code === 'ERROR') return 'error'
  if (code === 'W' || code === 'WARNING') return 'warning'
  if (code === 'S' || code === 'SUGGESTION') return 'suggestion'
  return 'warning' // default
}

/**
 * Get severity from type (E=4, W=3, S=2)
 */
function getSeverityFromType(t: string): number {
  const type = mapTypeCode(t)
  if (type === 'error') return 4
  if (type === 'warning') return 3
  return 2
}

/**
 * Normalize issue from simplified format to full format
 * Handles both old format (sectionKey, type, description...) and new format (s, t, fix)
 */
function normalizeIssue(raw: any, idx: number): AIReviewIssue | null {
  if (!raw || typeof raw !== 'object') return null
  
  // Extract section key (new: "s", old: "sectionKey")
  const sectionKey = raw.s || raw.sectionKey || 'general'
  
  // Extract type (new: "t" as E/W/S, old: "type" as full word)
  const typeRaw = raw.t || raw.type || 'W'
  const type = mapTypeCode(typeRaw)
  
  // Extract title
  const title = raw.title || 'Issue detected'
  
  // Extract fix (new: "fix", old: "fixPrompt" or "suggestion" or "description")
  const fix = raw.fix || raw.fixPrompt || raw.suggestion || raw.description || ''
  
  return {
    id: `ai-${idx}-${Date.now()}`,
    sectionKey,
    sectionLabel: SECTION_LABELS[sectionKey] || sectionKey || 'General',
    type,
    title,
    fix,
    category: raw.category || 'general', // Provide default category
    // Legacy fields for backward compatibility
    description: raw.description || fix,
    suggestion: raw.suggestion || fix,
    fixPrompt: raw.fixPrompt || fix,
    severity: typeof raw.severity === 'number' ? raw.severity : getSeverityFromType(typeRaw)
  }
}

/**
 * Extract issues array even if top-level JSON is broken or truncated
 * Handles both simplified format (s, t, fix) and old format (sectionKey, type, description...)
 */
function extractIssuesFromPartialJSON(text: string): any[] {
  const issues: any[] = []

  // Strategy 1: Try to find complete issue objects using regex (simplified format)
  // Look for {"s":"...", "t":"...", ...} patterns
  const simplifiedIssuePattern = /\{[^{}]*"s"\s*:\s*"[^"]*"[^{}]*"t"\s*:\s*"[^"]*"[^{}]*\}/g
  const simplifiedMatches = text.match(simplifiedIssuePattern)

  if (simplifiedMatches) {
    for (const match of simplifiedMatches) {
      try {
        const issue = JSON.parse(match)
        if (issue.s || issue.title) {
          issues.push(issue)
        }
      } catch {
        // Skip unparseable issues
      }
    }
  }

  // Strategy 2: Try old format (sectionKey, type)
  if (issues.length === 0) {
    const oldFormatPattern = /\{[^{}]*"sectionKey"\s*:\s*"[^"]*"[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g
    const oldMatches = text.match(oldFormatPattern)

    if (oldMatches) {
      for (const match of oldMatches) {
        try {
          const issue = JSON.parse(match)
          if (issue.sectionKey || issue.title) {
            issues.push(issue)
          }
        } catch {
          // Skip unparseable issues
        }
      }
    }
  }

  // Strategy 3: Try to find issues array and parse it more carefully
  if (issues.length === 0) {
    const issuesArrayMatch = text.match(/"issues"\s*:\s*\[([\s\S]*?)(?:\]|$)/)
    if (issuesArrayMatch) {
      const arrayContent = issuesArrayMatch[1]
      // Split by object boundaries and try to parse each
      const objectChunks = arrayContent.split(/\}\s*,?\s*\{/)
      for (let i = 0; i < objectChunks.length; i++) {
        let chunk = objectChunks[i].trim()
        // Add back braces if needed
        if (!chunk.startsWith('{')) chunk = '{' + chunk
        if (!chunk.endsWith('}')) {
          // Try to close the object - find the last complete key-value pair
          const lastQuoteIdx = chunk.lastIndexOf('"')
          if (lastQuoteIdx > 0) {
            const beforeQuote = chunk.substring(0, lastQuoteIdx + 1)
            if (beforeQuote.match(/"[^"]*"\s*:\s*"[^"]*"$/)) {
              chunk = beforeQuote + '}'
            }
          }
        }
        try {
          const issue = JSON.parse(chunk)
          if (issue.s || issue.sectionKey || issue.title || issue.t || issue.type) {
            issues.push(issue)
          }
        } catch {
          // Try with repaired JSON
          try {
            const repairedChunk = repairJSON(chunk)
            const issue = JSON.parse(repairedChunk)
            if (issue.s || issue.sectionKey || issue.title || issue.t || issue.type) {
              issues.push(issue)
            }
          } catch {
            // Skip this chunk
          }
        }
      }
    }
  }

  // Strategy 4: Extract key fields individually (handles both formats)
  if (issues.length === 0) {
    // Try simplified format first
    const sPattern = /"s"\s*:\s*"([^"]+)"/g
    const tPattern = /"t"\s*:\s*"([^"]+)"/g
    const titlePattern = /"title"\s*:\s*"([^"]+)"/g
    const fixPattern = /"fix"\s*:\s*"([^"]+)"/g

    const sMatches: string[] = []
    const tMatches: string[] = []
    const titleMatches: string[] = []
    const fixMatches: string[] = []

    let match: RegExpExecArray | null
    while ((match = sPattern.exec(text)) !== null) sMatches.push(match[1])
    while ((match = tPattern.exec(text)) !== null) tMatches.push(match[1])
    while ((match = titlePattern.exec(text)) !== null) titleMatches.push(match[1])
    while ((match = fixPattern.exec(text)) !== null) fixMatches.push(match[1])

    if (sMatches.length > 0 || tMatches.length > 0) {
      const count = Math.max(sMatches.length, tMatches.length, titleMatches.length)
      for (let i = 0; i < count; i++) {
        issues.push({
          s: sMatches[i] || 'general',
          t: tMatches[i] || 'W',
          title: titleMatches[i] || 'Issue detected (partial parse)',
          fix: fixMatches[i] || 'Please run the review again for full details'
        })
      }
    } else {
      // Fall back to old format field extraction
      const sectionKeyPattern = /"sectionKey"\s*:\s*"([^"]+)"/g
      const typePattern = /"type"\s*:\s*"([^"]+)"/g

      const sectionKeyMatches: string[] = []
      const typeMatches: string[] = []

      while ((match = sectionKeyPattern.exec(text)) !== null) sectionKeyMatches.push(match[1])
      while ((match = typePattern.exec(text)) !== null) typeMatches.push(match[1])

      if (sectionKeyMatches.length > 0 && typeMatches.length > 0) {
        for (let i = 0; i < Math.min(sectionKeyMatches.length, typeMatches.length); i++) {
          issues.push({
            sectionKey: sectionKeyMatches[i] || 'general',
            type: typeMatches[i] || 'warning',
            title: titleMatches[i] || 'Issue detected (partial parse)',
            fix: 'Please run the review again for full details'
          })
        }
      }
    }
  }

  console.log(`[AIReview] Extracted ${issues.length} issues from partial JSON`)
  return issues
}

function parseReviewResponse(output: string): {
  issues: AIReviewIssue[]
  summary: AIReviewResult['summary']
} {
  try {
    let text = (output || '').trim()

    console.log(`[AIReview] Raw output length: ${text.length}, starts with: ${text.substring(0, 50)}`)

    // Handle code fences - both closed and unclosed
    // First try to extract from closed fence
    const closedFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (closedFenceMatch) {
      text = closedFenceMatch[1].trim()
      console.log('[AIReview] Extracted from closed code fence')
    } else {
      // Check for unclosed fence (truncated output) - just strip the opening
      const unclosedFenceMatch = text.match(/```(?:json)?\s*([\s\S]*)/)
      if (unclosedFenceMatch && text.startsWith('```')) {
        text = unclosedFenceMatch[1].trim()
        console.log('[AIReview] Stripped unclosed code fence opening')
      }
    }

    // Find JSON object
    const start = text.indexOf('{')
    let end = text.lastIndexOf('}')

    // Handle truncated JSON - if no closing brace, try to salvage
    if (start === -1) {
      console.error('[AIReview] No opening brace found in response')
      throw new Error('No JSON object found - output may not contain JSON')
    }

    if (end === -1 || end < start) {
      console.warn('[AIReview] No closing brace found - JSON appears truncated, attempting salvage')
      // Try to extract partial data from truncated JSON
      const partialIssues = extractIssuesFromPartialJSON(text)
      if (partialIssues.length > 0) {
        console.log(`[AIReview] Salvaged ${partialIssues.length} issues from truncated JSON`)
        const normalizedIssues = partialIssues
          .map((issue: any, idx: number) => normalizeIssue(issue, idx))
          .filter((i): i is AIReviewIssue => i !== null)
        
        const errors = normalizedIssues.filter(i => i.type === 'error').length
        const warnings = normalizedIssues.filter(i => i.type === 'warning').length
        const suggestions = normalizedIssues.filter(i => i.type === 'suggestion').length
        
        return {
          issues: normalizedIssues,
          summary: {
            totalIssues: normalizedIssues.length,
            errors,
            warnings,
            suggestions,
            overallScore: 75, // Minimum baseline score for partial review
            recommendation: 'Review partially completed (output was truncated). Some issues were identified.'
          }
        }
      }
      throw new Error('No complete JSON object found - output truncated')
    }

    text = text.slice(start, end + 1)

    // Try parsing with progressive repairs
    let parsed: any = null
    const parseAttempts = [
      () => JSON.parse(text), // Try raw first
      () => JSON.parse(repairJSON(text)), // Try with repairs
      () => {
        // Last resort: extract what we can
        const issues = extractIssuesFromPartialJSON(text)
        // Support both new format (score) and old format (summary.overallScore)
        const scoreMatch = text.match(/"score"\s*:\s*(\d+)/) || text.match(/"overallScore"\s*:\s*(\d+)/)
        const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/) || text.match(/"recommendation"\s*:\s*"([^"]+)"/)
        return {
          issues,
          score: scoreMatch ? parseInt(scoreMatch[1]) : undefined,
          summary: summaryMatch ? summaryMatch[1] : undefined
        }
      }
    ]

    for (let i = 0; i < parseAttempts.length; i++) {
      try {
        parsed = parseAttempts[i]()
        if (parsed && (parsed.issues || parsed.score !== undefined || parsed.summary)) {
          if (i > 0) {
            console.log(`[AIReview] JSON parsed successfully on attempt ${i + 1}`)
          }
          break
        }
      } catch (e) {
        if (i === parseAttempts.length - 1) {
          console.error('All JSON parse attempts failed:', e)
          throw e
        }
      }
    }

    if (!parsed) {
      throw new Error('Could not parse response')
    }

    // Process issues using normalizeIssue to handle both formats
    const issues: AIReviewIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((issue: any, idx: number) => normalizeIssue(issue, idx))
          .filter((i: AIReviewIssue | null): i is AIReviewIssue => i !== null)
      : []

    // Count by type
    const errors = issues.filter(i => i.type === 'error').length
    const warnings = issues.filter(i => i.type === 'warning').length
    const suggestions = issues.filter(i => i.type === 'suggestion').length

    // Extract score - support both new format (score) and old format (summary.overallScore)
    let rawScore: number | undefined
    if (typeof parsed.score === 'number') {
      rawScore = parsed.score
    } else if (typeof parsed.summary?.overallScore === 'number') {
      rawScore = parsed.summary.overallScore
    } else if (typeof parsed.summary === 'number') {
      // Handle case where summary is accidentally a number
      rawScore = parsed.summary
    }

    // Extract recommendation - support both new format (summary as string) and old format (summary.recommendation)
    let recommendation: string | undefined
    if (typeof parsed.summary === 'string') {
      recommendation = parsed.summary
    } else if (typeof parsed.summary?.recommendation === 'string') {
      recommendation = parsed.summary.recommendation
    }

    const summary = {
      totalIssues: issues.length,
      errors,
      warnings,
      suggestions,
      // Enforce minimum score of 75, use AI score if valid otherwise calculate
      overallScore: typeof rawScore === 'number'
        ? Math.min(100, Math.max(75, rawScore)) // Min 75, max 100
        : calculateScore(errors, warnings, suggestions),
      recommendation: recommendation || getDefaultRecommendation(errors, warnings)
    }

    return { issues, summary }
  } catch (error) {
    console.error('Failed to parse AI review response:', error)
    // Log the raw output for debugging (first 500 chars)
    console.error('Raw output preview:', (output || '').substring(0, 500))
    return {
      issues: [],
      summary: {
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        suggestions: 0,
        overallScore: 75, // Minimum baseline score
        recommendation: 'Review completed but response parsing failed. Manual review recommended.'
      }
    }
  }
}

/**
 * Calculate score with minimum 75, max 100
 * Remaining 25 points distributed:
 * - Errors: 70% (17.5 points max deduction)
 * - Warnings: 20% (5 points max deduction)
 * - Suggestions: 10% (2.5 points max deduction)
 * 
 * As user fixes issues, score increases toward 100
 */
function calculateScore(errorCount: number, warningCount: number, suggestionCount: number): number {
  const BASE_SCORE = 75
  const REMAINING_POINTS = 25
  
  // No issues = perfect score
  if (errorCount === 0 && warningCount === 0 && suggestionCount === 0) {
    return 100
  }
  
  // Point allocations (from remaining 25)
  const ERROR_POOL = REMAINING_POINTS * 0.70     // 17.5 points
  const WARNING_POOL = REMAINING_POINTS * 0.20   // 5 points
  const SUGGESTION_POOL = REMAINING_POINTS * 0.10 // 2.5 points
  
  // Points per issue (diminishing returns for many issues)
  // First few issues have more impact, then it tapers off
  const errorDeduction = Math.min(ERROR_POOL, errorCount * 4)           // ~4 pts per error, max 17.5
  const warningDeduction = Math.min(WARNING_POOL, warningCount * 1.25)   // ~1.25 pts per warning, max 5
  const suggestionDeduction = Math.min(SUGGESTION_POOL, suggestionCount * 0.5) // ~0.5 pts per suggestion, max 2.5
  
  const totalDeduction = errorDeduction + warningDeduction + suggestionDeduction
  const score = BASE_SCORE + (REMAINING_POINTS - totalDeduction)
  
  // Ensure score is between 75 and 100
  return Math.round(Math.min(100, Math.max(BASE_SCORE, score)))
}

function getDefaultRecommendation(errors: number, warnings: number): string {
  if (errors === 0 && warnings === 0) {
    return 'Draft looks good! Ready for export.'
  } else if (errors === 0) {
    return `Found ${warnings} warning(s). Review recommended before export.`
  } else {
    return `Found ${errors} error(s) that should be fixed before filing.`
  }
}

// ============================================================================
// Fix Application
// ============================================================================

export interface FixContext {
  relatedContent?: Record<string, string>
  figures?: Array<{ figureNo: number; title: string; plantuml: string }>
  components?: Array<{ name: string; numeral: string }>
}

/**
 * Build a regeneration prompt that incorporates the fix instruction
 * Designed for a lighter LLM to apply targeted fixes
 */
export function buildFixPrompt(
  originalContent: string,
  issue: AIReviewIssue,
  context?: FixContext
): string {
  let contextBlock = ''
  
  // Add related sections if provided
  if (context?.relatedContent && Object.keys(context.relatedContent).length > 0) {
    contextBlock += '\n\n═══ RELATED SECTIONS FOR REFERENCE ═══\n' + 
      Object.entries(context.relatedContent)
        .map(([key, val]) => `### ${SECTION_LABELS[key] || key}\n${val.substring(0, 1500)}`)
        .join('\n\n')
  }

  // Add diagram context if issue is diagram-related
  if (issue.category === 'diagram' && context?.figures && context.figures.length > 0) {
    contextBlock += '\n\n═══ DIAGRAM INFORMATION (PlantUML Code) ═══\n'
    contextBlock += 'The following diagrams are part of the patent. They are provided as PlantUML code:\n\n'
    contextBlock += context.figures.map(f => 
      `Figure ${f.figureNo}: ${f.title}\n\`\`\`plantuml\n${f.plantuml.substring(0, 800)}\n\`\`\``
    ).join('\n\n')
  }

  // Add components reference if available
  if (context?.components && context.components.length > 0) {
    contextBlock += '\n\n═══ DECLARED COMPONENTS ═══\n'
    contextBlock += context.components
      .sort((a, b) => parseInt(a.numeral) - parseInt(b.numeral))
      .map(c => `- ${c.name} (${c.numeral})`)
      .join('\n')
  }

  return `You are a patent text editor performing SURGICAL, MINIMAL revisions. Your task is to fix ONE specific issue while keeping EVERYTHING ELSE exactly as-is.

═══════════════════════════════════════════════════════════════════════════════
⚠️ CRITICAL RULE: MINIMAL CHANGES ONLY
═══════════════════════════════════════════════════════════════════════════════
- Change ONLY the specific words/sentences needed to fix the issue
- Do NOT rewrite, rephrase, or "improve" any other text
- Do NOT change formatting, paragraph structure, or sentence order
- Do NOT add new content unless specifically required by the fix
- Do NOT remove content unless specifically required by the fix
- The output should be 95%+ identical to the original

═══════════════════════════════════════════════════════════════════════════════
FIX INSTRUCTION (Apply precisely, nothing more)
═══════════════════════════════════════════════════════════════════════════════
${issue.fix || issue.fixPrompt}

═══════════════════════════════════════════════════════════════════════════════
ADDITIONAL CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Issue Category: ${issue.category}
Issue Title: ${issue.title}
${contextBlock}

═══════════════════════════════════════════════════════════════════════════════
CURRENT SECTION CONTENT (to be revised - PRESERVE EVERYTHING NOT RELATED TO THE FIX)
═══════════════════════════════════════════════════════════════════════════════
${originalContent}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
1. Read the entire section carefully
2. Locate ONLY the specific text that relates to the issue
3. Make the MINIMUM change needed to fix the issue
4. Keep ALL other text EXACTLY as it appears (same words, punctuation, formatting)
5. Do NOT "clean up" or "improve" unrelated text
6. Output the FULL section with your minimal fix applied

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST (Verify before output)
═══════════════════════════════════════════════════════════════════════════════
✓ Did I change ONLY what was necessary to fix the issue?
✓ Is all unrelated text EXACTLY the same as the original?
✓ Did I preserve the original formatting and paragraph structure?
✓ Is my change targeted and surgical, not a rewrite?

OUTPUT THE REVISED SECTION TEXT BELOW (full section with minimal fix applied):`
}

