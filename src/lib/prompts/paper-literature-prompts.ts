export interface LiteratureGapCitation {
  citationKey: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
}

export interface LiteratureGapContext {
  researchQuestion?: string | null;
  title?: string | null;
  methodology?: string | null;
  contributionType?: string | null;
}

const BASE_RULES = `Rules:
- Output ONLY valid JSON. Do not include code fences or extra commentary.
- If the input is too limited, set arrays to empty and provide clarifyingQuestions.
- Use concise academic phrasing.`;

export function buildLiteratureGapPrompt(
  citations: LiteratureGapCitation[],
  context: LiteratureGapContext = {}
): string {
  const items = citations.map(citation => {
    const authors = Array.isArray(citation.authors) ? citation.authors.join(', ') : '';
    const year = citation.year ? `(${citation.year})` : '';
    const venue = citation.venue ? ` - ${citation.venue}` : '';
    const abstractText = citation.abstract ? citation.abstract.slice(0, 600) : '';
    const abstract = abstractText ? `Abstract: ${abstractText}` : '';
    return `- [${citation.citationKey}] ${citation.title} ${year}${venue} ${authors}\n  ${abstract}`.trim();
  }).join('\n');

  return `You are an academic literature analyst.
${BASE_RULES}

Task: Analyze the provided literature list to identify themes, gaps, and positioning opportunities.

Context:
Title: ${context.title || ''}
Research question: ${context.researchQuestion || ''}
Methodology: ${context.methodology || ''}
Contribution type: ${context.contributionType || ''}

Literature list:
${items}

Return JSON in this shape:
{
  "themes": ["theme 1", "theme 2"],
  "gaps": ["gap 1", "gap 2"],
  "positioning": ["positioning suggestion 1", "positioning suggestion 2"],
  "clarifyingQuestions": ["question 1", "question 2"]
}`;
}
