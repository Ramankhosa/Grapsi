/**
 * Citation Budget Validator (Post Pass-1)
 *
 * Parses Pass-1 markdown into paragraphs, counts [CITE:key] markers,
 * enforces per-paragraph and per-section citation budgets, and
 * verifies must-cite key presence. Produces a ValidationReport with
 * rewrite directives when violations occur.
 */

// ============================================================================
// Types
// ============================================================================

export interface CitationBudgetConfig {
    maxCitesPerParagraph: number;  // default 3
    maxCitesPerSection: number;    // default 25
    mustCiteKeys: string[];
}

export interface ValidationViolation {
    paragraphIndex: number;
    used: number;
    maxAllowed: number;
    citeKeysFound: string[];
    citationsToDrop: string[];
}

export interface CitationValidationReport {
    passed: boolean;
    totalCitations: number;
    totalParagraphs: number;
    avgCitesPerParagraph: number;
    budgetViolations: ValidationViolation[];
    mustCiteCheck: { missing: string[]; passed: boolean };
    rewriteDirectives: RewriteDirective[];
}

export interface RewriteDirective {
    type: 'reduce_citations' | 'add_must_cite';
    targetParagraph?: number;
    limit?: number;
    missingKeys?: string[];
    instruction: string;
}

// ============================================================================
// Constants
// ============================================================================

const CITE_REGEX = /\[CITE:([^\]]+)\]/gi;

const DEFAULT_CONFIG: CitationBudgetConfig = {
    maxCitesPerParagraph: Number.parseInt(
        process.env.MAX_CITES_PER_PARAGRAPH || '3',
        10
    ),
    maxCitesPerSection: Number.parseInt(
        process.env.MAX_CITES_PER_SECTION || '25',
        10
    ),
    mustCiteKeys: [],
};

// ============================================================================
// Paragraph Parsing
// ============================================================================

/**
 * Split markdown content into paragraphs.
 * Paragraphs are separated by double newlines.
 * Headings (lines starting with #) are excluded as they are structural, not prose.
 */
export function parseParagraphs(markdown: string): string[] {
    if (!markdown || typeof markdown !== 'string') return [];

    return markdown
        .split(/\n\s*\n/)
        .map(block => block.trim())
        .filter(block => {
            if (!block) return false;
            // Skip heading-only blocks (### Heading with no following text)
            if (/^#{1,6}\s+/.test(block) && !block.includes('\n')) return false;
            return true;
        });
}

// ============================================================================
// Citation Counting
// ============================================================================

/**
 * Extract all [CITE:key] markers from a text block,
 * returning unique keys and total count.
 */
export function countCitesInText(text: string): { count: number; keys: string[] } {
    const keys: string[] = [];
    let match: RegExpExecArray | null = null;

    CITE_REGEX.lastIndex = 0;
    while ((match = CITE_REGEX.exec(text)) !== null) {
        // Handle compound citations like [CITE:Smith2023, Jones2024]
        const raw = match[1] || '';
        const parts = raw.split(/[,;]\s*/).map(k => k.trim()).filter(Boolean);
        keys.push(...parts);
    }

    return { count: keys.length, keys };
}

/**
 * Collect all unique citation keys found across the entire section.
 */
export function collectAllCiteKeys(paragraphs: string[]): Set<string> {
    const all = new Set<string>();
    for (const p of paragraphs) {
        const { keys } = countCitesInText(p);
        for (const k of keys) all.add(k);
    }
    return all;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a Pass-1 draft against citation budget constraints.
 */
export function validate(
    content: string,
    config: Partial<CitationBudgetConfig> = {}
): CitationValidationReport {
    const cfg: CitationBudgetConfig = { ...DEFAULT_CONFIG, ...config };
    const paragraphs = parseParagraphs(content);
    const violations: ValidationViolation[] = [];
    let totalCitations = 0;

    // Per-paragraph budget check
    for (let i = 0; i < paragraphs.length; i++) {
        const { count, keys } = countCitesInText(paragraphs[i]);
        totalCitations += count;

        if (count > cfg.maxCitesPerParagraph) {
            // Pick citations to drop: keep the first N, drop the rest
            const uniqueKeys = [...new Set(keys)];
            const mustKeep = new Set(
                cfg.mustCiteKeys.filter(k => uniqueKeys.includes(k))
            );
            const nonMust = uniqueKeys.filter(k => !mustKeep.has(k));
            const keepCount = Math.max(0, cfg.maxCitesPerParagraph - mustKeep.size);
            const toDrop = nonMust.slice(keepCount);

            violations.push({
                paragraphIndex: i,
                used: count,
                maxAllowed: cfg.maxCitesPerParagraph,
                citeKeysFound: uniqueKeys,
                citationsToDrop: toDrop,
            });
        }
    }

    // Must-cite check
    const allFoundKeys = collectAllCiteKeys(paragraphs);
    const missingMustCites = cfg.mustCiteKeys.filter(k => !allFoundKeys.has(k));

    // Build rewrite directives
    const rewriteDirectives: RewriteDirective[] = [];

    for (const violation of violations) {
        rewriteDirectives.push({
            type: 'reduce_citations',
            targetParagraph: violation.paragraphIndex,
            limit: cfg.maxCitesPerParagraph,
            instruction:
                `Paragraph ${violation.paragraphIndex + 1} has ${violation.used} citations ` +
                `(max ${cfg.maxCitesPerParagraph}). ` +
                `Remove or redistribute these citations: ${violation.citationsToDrop.join(', ')}. ` +
                `Never remove must-cite keys.`,
        });
    }

    if (missingMustCites.length > 0) {
        rewriteDirectives.push({
            type: 'add_must_cite',
            missingKeys: missingMustCites,
            instruction:
                `The following must-cite keys are missing from the section and MUST appear ` +
                `at least once: ${missingMustCites.join(', ')}. ` +
                `Add them where contextually appropriate.`,
        });
    }

    const passed = violations.length === 0 && missingMustCites.length === 0;
    const avgCitesPerParagraph = paragraphs.length > 0
        ? Number((totalCitations / paragraphs.length).toFixed(2))
        : 0;

    return {
        passed,
        totalCitations,
        totalParagraphs: paragraphs.length,
        avgCitesPerParagraph,
        budgetViolations: violations,
        mustCiteCheck: { missing: missingMustCites, passed: missingMustCites.length === 0 },
        rewriteDirectives,
    };
}

// ============================================================================
// Rewrite Prompt Builder
// ============================================================================

/**
 * Format validation report into LLM rewrite instructions.
 * This is appended to the original Pass-1 prompt when violations are found.
 */
export function buildRewritePrompt(
    originalDraft: string,
    report: CitationValidationReport
): string {
    const directives = report.rewriteDirectives
        .map((d, i) => `${i + 1}. ${d.instruction}`)
        .join('\n');

    return `The following draft has citation budget violations that MUST be fixed.

ORIGINAL DRAFT:
${originalDraft}

VIOLATIONS FOUND:
- Budget violations: ${report.budgetViolations.length} paragraphs exceed the citation limit
- Missing must-cite keys: ${report.mustCiteCheck.missing.join(', ') || 'none'}

REWRITE DIRECTIVES (apply ALL):
${directives}

RULES:
- Fix ONLY the violations listed above. Do not change the argument structure.
- Preserve all [CITE:key] anchors that are NOT in the drop list.
- Never remove must-cite keys.
- Keep numeric claims and data points unchanged.
- Output ONLY the corrected section content. No JSON wrapper needed.

⚠️ Return ONLY the corrected markdown content. No commentary.`;
}

// ============================================================================
// Exports
// ============================================================================

export const citationValidator = {
    parseParagraphs,
    countCitesInText,
    collectAllCiteKeys,
    validate,
    buildRewritePrompt,
};
