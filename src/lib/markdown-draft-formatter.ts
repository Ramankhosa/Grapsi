type LineKind = 'blank' | 'heading' | 'ul' | 'ol' | 'blockquote' | 'text';

const FENCED_BLOCK_REGEX = /```(?:markdown|md|text|txt)?\s*([\s\S]*?)```/gi;
const HEADING_REGEX = /^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/;
const BULLET_REGEX = /^(\s*)([-*+\u2022\u25E6\u25AA\u2023\u00B7])\s+(.+)$/;
const ORDERED_REGEX = /^(\s*)(\d+)[.)]\s+(.+)$/;
const BLOCKQUOTE_REGEX = /^>\s*(.*)$/;

/**
 * Bold-line heading promotion:
 * Only promote **Bold Text** if it's ALONE on a line (no trailing prose), has 2-80 chars,
 * AND is NOT inside a list item or part of inline formatting.
 * This prevents false positives like "**Data Sources:** ..." or "**Key term** explanation..."
 */
const BOLD_HEADING_REGEX = /^\s*\*\*([^*]{2,80})\*\*:?\s*$/;

/**
 * Colon-heading promotion:
 * Only promote "ALL_CAPS_WORD:" or "Title Case Word:" when:
 * - Starts with a capital letter
 * - Is 3-60 chars (stricter than before to avoid false positives)
 * - Is ALONE on a line with nothing after the colon
 * - Must have at least 2 words or be all-uppercase to distinguish from labels
 */
const COLON_HEADING_REGEX = /^\s*([A-Z][A-Z0-9 ]{2,60}):\s*$/;

/**
 * Detect lines that are inline bold labels (not headings).
 * e.g., "**Data Sources:** We collected..." or "**Step 1:** First..."
 * These should NOT be promoted to headings.
 */
const BOLD_LABEL_REGEX = /^\s*\*\*[^*]+\*\*:\s+\S/;

function lineKind(line: string): LineKind {
  if (!line.trim()) return 'blank';
  if (HEADING_REGEX.test(line)) return 'heading';
  if (BULLET_REGEX.test(line)) return 'ul';
  if (ORDERED_REGEX.test(line)) return 'ol';
  if (BLOCKQUOTE_REGEX.test(line)) return 'blockquote';
  return 'text';
}

function normalizeIndent(rawIndent: string): string {
  const spaces = rawIndent.replace(/\t/g, '  ').length;
  const level = Math.max(0, Math.floor(spaces / 2));
  return '  '.repeat(level);
}

function cleanInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanHeadingText(value: string): string {
  return cleanInlineText(value).replace(/:\s*$/, '');
}

function normalizeLine(rawLine: string): string {
  const line = rawLine.replace(/\t/g, '  ').replace(/\s+$/g, '');
  if (!line.trim()) return '';

  // Explicit markdown headings (# through ######)
  const headingMatch = line.match(HEADING_REGEX);
  if (headingMatch) {
    const requested = headingMatch[1].length;
    const level = Math.max(2, Math.min(4, requested));
    return `${'#'.repeat(level)} ${cleanHeadingText(headingMatch[2])}`;
  }

  // Blockquote lines: preserve as-is after trimming
  const blockquoteMatch = line.match(BLOCKQUOTE_REGEX);
  if (blockquoteMatch) {
    const content = blockquoteMatch[1].trim();
    return content ? `> ${content}` : '>';
  }

  // Bold-label lines (e.g., "**Key:** explanation") should NOT become headings
  if (BOLD_LABEL_REGEX.test(line)) {
    return line;
  }

  // Bold heading promotion: only standalone bold text on its own line
  const boldHeadingMatch = line.match(BOLD_HEADING_REGEX);
  if (boldHeadingMatch) {
    return `### ${cleanHeadingText(boldHeadingMatch[1])}`;
  }

  // Colon heading promotion: only ALL-CAPS words followed by colon on own line
  const colonHeadingMatch = line.match(COLON_HEADING_REGEX);
  if (colonHeadingMatch) {
    return `### ${cleanHeadingText(colonHeadingMatch[1])}`;
  }

  // Bullet list normalization
  const bulletMatch = line.match(BULLET_REGEX);
  if (bulletMatch) {
    const indent = normalizeIndent(bulletMatch[1]);
    return `${indent}- ${cleanInlineText(bulletMatch[3])}`;
  }

  // Ordered list normalization
  const orderedMatch = line.match(ORDERED_REGEX);
  if (orderedMatch) {
    const indent = normalizeIndent(orderedMatch[1]);
    return `${indent}${orderedMatch[2]}. ${cleanInlineText(orderedMatch[3])}`;
  }

  return line;
}

function stripWrappingFences(raw: string): string {
  const text = raw || '';
  let best = '';
  const regex = new RegExp(FENCED_BLOCK_REGEX.source, FENCED_BLOCK_REGEX.flags);
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = (match[1] || '').trim();
    if (candidate.length > best.length) {
      best = candidate;
    }
  }

  return (best || text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/**
 * Some LLM JSON outputs contain literal escaped line breaks (e.g., "\\n")
 * in content strings. Decode those when they dominate the text so markdown
 * headings/lists are parsed as separate lines instead of a single block.
 */
function decodeEscapedLineBreaks(raw: string): string {
  if (!raw) return '';

  const escapedBreaks = raw.match(/\\r\\n|\\n|\\r/g)?.length || 0;
  if (escapedBreaks === 0) return raw;

  const realBreaks = raw.match(/\r\n?|\n/g)?.length || 0;
  const shouldDecode = realBreaks === 0 || escapedBreaks > realBreaks * 2;
  if (!shouldDecode) return raw;

  return raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * Remove inline bold/italic emphasis so content renders in normal text style.
 * Keeps structure (headings, lists, blockquotes, citations) intact.
 */
export function stripInlineMarkdownStyling(raw: string): string {
  let text = String(raw || '');
  if (!text) return '';

  text = text
    .replace(/<\/?(strong|em|i|b)\b[^>]*>/gi, '')
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '$1')
    .replace(/___([\s\S]+?)___/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1$2');

  return text;
}

export function polishDraftMarkdown(raw: string): string {
  const stripped = decodeEscapedLineBreaks(stripWrappingFences(raw));
  if (!stripped) return '';

  const rawLines = stripped.split('\n');
  const normalizedLines = rawLines.map(normalizeLine);
  const output: string[] = [];
  let lastNonBlank: LineKind = 'blank';

  for (const line of normalizedLines) {
    const kind = lineKind(line);

    if (kind === 'blank') {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    const isList = kind === 'ul' || kind === 'ol';
    const wasList = lastNonBlank === 'ul' || lastNonBlank === 'ol';
    const needsGapBeforeHeading = kind === 'heading' && output.length > 0 && output[output.length - 1] !== '';
    const needsGapTextAfterList = kind === 'text' && wasList && output[output.length - 1] !== '';
    const needsGapListAfterText = isList && lastNonBlank === 'text' && output[output.length - 1] !== '';
    const needsGapAfterHeading = kind !== 'heading' && lastNonBlank === 'heading' && output[output.length - 1] !== '';
    // Add gap before/after blockquote when transitioning from/to other block types
    const needsGapBeforeBlockquote = kind === 'blockquote' && lastNonBlank !== 'blockquote' && lastNonBlank !== 'blank' && output[output.length - 1] !== '';
    const needsGapAfterBlockquote = kind !== 'blockquote' && lastNonBlank === 'blockquote' && output[output.length - 1] !== '';

    if (needsGapBeforeHeading || needsGapTextAfterList || needsGapListAfterText || needsGapAfterHeading || needsGapBeforeBlockquote || needsGapAfterBlockquote) {
      output.push('');
    }

    output.push(line);
    lastNonBlank = kind;
  }

  while (output.length > 0 && output[0] === '') output.shift();
  while (output.length > 0 && output[output.length - 1] === '') output.pop();

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatBibliographyMarkdown(
  bibliography: string,
  sortOrder: 'alphabetical' | 'order_of_appearance' = 'alphabetical'
): string {
  const text = (bibliography || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  const entries = text
    .split(/\n\s*\n+/)
    .map(entry => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (entries.length === 0) return '';

  const asMarkdown = sortOrder === 'order_of_appearance'
    ? entries
        .map((entry, index) => {
          const stripped = entry.replace(/^\[(\d+)\]\s+/, '').trim();
          return `${index + 1}. ${stripped}`;
        })
        .join('\n')
    : entries.map(entry => `- ${entry}`).join('\n');

  return polishDraftMarkdown(asMarkdown);
}
