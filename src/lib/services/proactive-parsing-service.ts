import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';
import type { PreparedPaperSection } from './deep-analysis-types';
import { removeNullCharacters, sanitizeForPostgres, sanitizeTextForPostgres } from '../utils/postgres-sanitize';
import { pdfMatchVerificationService } from './pdf-match-verification-service';

// ─── Configuration ──────────────────────────────────────────────────────────

const PARSE_CONCURRENCY = Math.max(1, Math.min(6,
  Number.parseInt(String(process.env.PDF_PARSE_CONCURRENCY || '3'), 10) || 3
));
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2_000;
const PROCESSING_STALE_MS = 120 * 1000;

// ─── HMR-safe global state ─────────────────────────────────────────────────

interface QueueEntry {
  documentId: string;
  attempt: number;
  addedAt: number;
  source: string;
}

interface GlobalParsingState {
  queue: Map<string, QueueEntry>;
  inFlight: number;
  waiters: Array<() => void>;
  processing: boolean;
  processingStartedAt: number;
}

const globalForParsing = globalThis as unknown as { __proactiveParsing?: GlobalParsingState };
if (!globalForParsing.__proactiveParsing) {
  globalForParsing.__proactiveParsing = {
    queue: new Map(),
    inFlight: 0,
    waiters: [],
    processing: false,
    processingStartedAt: 0,
  };
}
const STATE = globalForParsing.__proactiveParsing;

// ─── pdfjs-dist text extraction ─────────────────────────────────────────────

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => {
      try {
        const pkgDir = require('path').dirname(require.resolve('pdfjs-dist/package.json'));
        const workerPath = require('path').join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
        if (require('fs').existsSync(workerPath)) {
          mod.GlobalWorkerOptions.workerSrc = `file://${workerPath.replace(/\\/g, '/')}`;
        }
      } catch {
        console.warn('[ProactiveParsing] Could not resolve pdfjs worker path, using main-thread fallback');
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

// ─── Line-level grouping ─────────────────────────────────────────────────────
// Groups raw TextItems into logical lines by y-proximity, reducing word-level
// noise and enabling reliable column / spanning analysis.

interface TextLine {
  y: number;
  minX: number;
  maxX: number;
  width: number;
  text: string;
}

function groupIntoLines(items: TextItem[], yTolerance = 3): TextLine[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextLine[] = [];
  let batch: TextItem[] = [sorted[0]];
  let batchY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - batchY) <= yTolerance) {
      batch.push(item);
    } else {
      lines.push(buildLine(batch, batchY));
      batch = [item];
      batchY = item.y;
    }
  }
  if (batch.length > 0) lines.push(buildLine(batch, batchY));

  return lines;
}

function buildLine(items: TextItem[], y: number): TextLine {
  items.sort((a, b) => a.x - b.x);

  const minX = items[0].x;
  const maxX = Math.max(...items.map(i => i.x + i.width));

  let text = '';
  for (const item of items) {
    const chunk = removeNullCharacters(item.str || '');
    if (!chunk) continue;
    if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
      text += ' ';
    }
    text += chunk;
  }

  return { y, minX, maxX, width: maxX - minX, text: text.trim() };
}

// ─── Data-driven gutter detection ────────────────────────────────────────────
// Instead of a fixed midpoint ± 8%, we cluster left-edges of non-spanning
// lines and look for a large gap. This adapts to any page layout, margin
// style, or template.

function detectGutter(
  lines: TextLine[],
): { gutter: number; isTwoColumn: boolean } {
  const edges = lines
    .filter(l => l.text.length > 0)
    .map(l => l.minX)
    .sort((a, b) => a - b);

  if (edges.length < 8) return { gutter: 0, isTwoColumn: false };

  // Find largest gap in left-edges within the 15%-85% range
  const lo = Math.floor(edges.length * 0.15);
  const hi = Math.ceil(edges.length * 0.85);

  let maxGap = 0;
  let splitIdx = -1;

  for (let i = lo; i < hi - 1; i++) {
    const gap = edges[i + 1] - edges[i];
    if (gap > maxGap) {
      maxGap = gap;
      splitIdx = i;
    }
  }

  // Compute median inter-edge gap for relative comparison
  const allGaps: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    allGaps.push(edges[i + 1] - edges[i]);
  }
  allGaps.sort((a, b) => a - b);
  const medianGap = allGaps[Math.floor(allGaps.length / 2)] || 0;

  // Gutter must be significantly larger than within-cluster variation
  // and at least 15pt (a real gutter is ≥ 0.2 inches ≈ 14pt)
  if (maxGap < Math.max(medianGap * 3, 15)) {
    return { gutter: 0, isTwoColumn: false };
  }

  // Bimodality: both sides need ≥ 15% of lines
  const leftCount = splitIdx + 1;
  const rightCount = edges.length - leftCount;
  if (leftCount < edges.length * 0.15 || rightCount < edges.length * 0.15) {
    return { gutter: 0, isTwoColumn: false };
  }

  const gutterX = (edges[splitIdx] + edges[splitIdx + 1]) / 2;
  return { gutter: gutterX, isTwoColumn: true };
}

// ─── Column-aware page reconstruction ────────────────────────────────────────
// 1. Group items → lines
// 2. Classify lines as spanning (> 55% content width) or column
// 3. Detect gutter from column lines only
// 4. Band-based assembly: spanning lines flush column accumulators and
//    appear in correct vertical position between left-then-right runs.

function reconstructPageText(items: TextItem[], _pageWidth: number): string {
  if (items.length === 0) return '';

  const lines = groupIntoLines(items);
  const nonEmpty = lines.filter(l => l.text.length > 0);
  if (nonEmpty.length === 0) return '';

  const contentLeft = Math.min(...nonEmpty.map(l => l.minX));
  const contentRight = Math.max(...nonEmpty.map(l => l.maxX));
  const contentWidth = contentRight - contentLeft;

  if (contentWidth <= 0) {
    return nonEmpty.map(l => l.text).join('\n');
  }

  const SPAN_RATIO = 0.55;
  const columnCandidates = nonEmpty.filter(l => l.width <= contentWidth * SPAN_RATIO);

  const { gutter, isTwoColumn } = detectGutter(columnCandidates);

  if (!isTwoColumn) {
    return nonEmpty.map(l => l.text).join('\n');
  }

  // Tag every line: spanning / left / right
  type Tag = 'spanning' | 'left' | 'right';
  const tagged: { text: string; tag: Tag }[] = nonEmpty.map(line => {
    if (line.width > contentWidth * SPAN_RATIO) {
      return { text: line.text, tag: 'spanning' };
    }
    return { text: line.text, tag: line.minX < gutter ? 'left' : 'right' };
  });

  // Band-based assembly: spanning elements flush the current column
  // accumulators so headings appear between column segments, not inside them.
  const output: string[] = [];
  let leftBand: string[] = [];
  let rightBand: string[] = [];

  for (const { text, tag } of tagged) {
    if (tag === 'spanning') {
      output.push(...leftBand, ...rightBand);
      leftBand = [];
      rightBand = [];
      output.push(text);
    } else if (tag === 'left') {
      leftBand.push(text);
    } else {
      rightBand.push(text);
    }
  }
  output.push(...leftBand, ...rightBand);

  return output.join('\n');
}

async function extractTextWithPdfjs(filePath: string): Promise<{ pages: string[]; fullText: string } | null> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));

  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    const textItems: TextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const ti = item as { str: string; transform: number[]; width: number };
      textItems.push({
        str: ti.str,
        x: ti.transform[4],
        y: ti.transform[5],
        width: ti.width ?? 0,
      });
    }

    pages.push(reconstructPageText(textItems, viewport.width));
  }

  const rawText = pages.join('\n\n').trim();
  if (rawText.length < 50) return null;

  const fullText = stripTrailingSections(rawText);
  return { pages, fullText };
}

// ─── Repeated-line classification ────────────────────────────────────────────
// Protects meaningful repeated labels from header/footer removal.

const REPEATED_LINE_WHITELIST = /^(?:algorithm|theorem|lemma|corollary|proposition|definition|proof|figure|table|equation|step|case|example|property|claim|remark|observation|conjecture|axiom|hypothesis)\s+\d/i;

function isHeaderFooterLike(line: string): boolean {
  const t = line.trim();
  if (/^\d{1,4}$/.test(t)) return true;
  if (/\b(?:copyright|©|permission|licensed|creative\s+commons)\b/i.test(t)) return true;
  if (/\b(?:ACM|IEEE|Springer|Elsevier|Wiley|AAAI|NeurIPS|ICML|CVPR|ICLR|arXiv)\b/.test(t)) return true;
  if (/^(?:published|accepted|submitted|appeared)\s+(?:in|at|to)\b/i.test(t)) return true;
  if (t.length < 50 && t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  if (/^https?:\/\//.test(t)) return true;
  return false;
}

// ─── Text normalization for token efficiency ────────────────────────────────

function normalizeExtractedText(text: string): string {
  let v = removeNullCharacters(text || '');

  // Rejoin hyphenated line breaks: "computa-\ntional" → "computational"
  v = v.replace(/([a-zA-Z])-\n([a-zA-Z])/g, '$1$2');

  // Collapse PDF line breaks within paragraphs into spaces.
  // A true paragraph break has a blank line; a PDF column-wrap just has \n.
  // Heuristic: if a line ends with a lowercase letter/comma and the next starts
  // with a lowercase letter, it's a wrapped line, not a paragraph break.
  v = v.replace(/([a-z,;])\n([a-z])/g, '$1 $2');

  // Normalise whitespace
  v = v.replace(/\r\n/g, '\n');
  v = v.replace(/[ \t]+/g, ' ');          // multiple spaces/tabs → single space
  v = v.replace(/ \n/g, '\n');             // trailing spaces on lines
  v = v.replace(/\n /g, '\n');             // leading spaces on lines
  v = v.replace(/\n{3,}/g, '\n\n');        // 3+ blank lines → one blank line

  // Remove standalone page numbers / citation markers
  v = v.replace(/\n\s*[\[(]?\d{1,4}[\])]?\s*\n/g, '\n');

  // Remove common PDF artifacts: lone bullets, dashes, dots used as separators
  v = v.replace(/\n\s*[•·▪▸►–—―]+\s*\n/g, '\n');

  // Remove repeated short lines that look like headers/footers.
  // Uses a whitelist to protect "Algorithm 1", "Theorem 2", etc. and a
  // header/footer heuristic to avoid deleting real content.
  const lineArr = v.split('\n');
  const freq = new Map<string, number>();
  for (const raw of lineArr) {
    const l = raw.trim();
    if (l.length > 3 && l.length <= 100 && l.split(/\s+/).length <= 12) {
      freq.set(l, (freq.get(l) || 0) + 1);
    }
  }
  if (freq.size > 0) {
    const filtered = lineArr.filter(raw => {
      const l = raw.trim();
      if (!l) return true;
      const count = freq.get(l) || 0;
      if (count < 4) return true;
      if (REPEATED_LINE_WHITELIST.test(l)) return true;
      return isHeaderFooterLike(l);
    });
    v = filtered.join('\n');
  }

  return removeNullCharacters(v).trim();
}

// ─── Heading classification ─────────────────────────────────────────────────
// HARD_STOP: triggers raw-text truncation (Layer 1) and section break (Layer 2).
// Only patterns that definitively end useful paper content.
const HARD_STOP_HEADING = /^(?:(?:section\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])\s*[.)\-:]?\s*)?(?:references?|bibliography|works?\s+cited|cited\s+literature|reference\s+list|literature\s+cited|references?\s+and\s+notes?)\s*(?:[:.\-]\s*)?$/i;

// SOFT_DROP: section is excluded from output but does NOT truncate raw text.
// Content after these may still contain appendices/supplementary worth keeping.
const SOFT_DROP_HEADING = /^(?:(?:section\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])\s*[.)\-:]?\s*)?(?:acknowledg(?:e?ment|ment)s?|author\s+biograph(?:y|ies)|funding(?:\s+(?:statement|sources?))?|conflicts?\s+of\s+interests?|competing\s+interests?|declarations?\s+of\s+interests?|disclosure\s+statements?)\s*(?:[:.\-]\s*)?$/i;

// ─── Heading-line validation ────────────────────────────────────────────────
// Confirms a matched line really looks like a section heading, not body text.

function isHeadingLike(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/\.\s*$/.test(t) && !/(?:al|etc|vs|Fig|Eq)\.\s*$/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  const punctuation = t.replace(/[a-zA-Z0-9\s\-.:()]/g, '');
  if (punctuation.length > 3) return false;
  return true;
}

// ─── Reference-density confirmation ─────────────────────────────────────────
// Checks that lines following a candidate heading actually look like reference
// entries (IEEE [N], numeric N., DOI/arXiv/vol./pp., year+author patterns).
// Prevents truncation when "References" appears as a discussion topic or TOC entry.

function confirmReferenceDensity(
  text: string,
  headingEndOffset: number,
  windowLines = 60,
  threshold = 8,
): boolean {
  const after = text.slice(headingEndOffset);
  const lines = after.split('\n').slice(0, windowLines);
  let nonEmpty = 0;
  let score = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    nonEmpty++;

    if (/^\[\s*\d{1,4}\s*\]/.test(t)) { score += 3; continue; }
    if (/^\d{1,4}[\].)]\s+\S/.test(t)) { score += 3; continue; }
    if (/\b(?:doi\s*[:.]?|10\.\d{4,9}\/|arxiv\s*[:.]?|isbn)\b/i.test(t)) score += 2;
    if (/\b(?:vol\.?|pp\.?|no\.?)\b/i.test(t)) score += 1;
    if (/\b(?:19|20)\d{2}\b/.test(t)) score += 1;
    if (/https?:\/\//i.test(t) || /\bwww\./i.test(t)) score += 1;
    if (/[A-Z][a-z]+,\s*(?:[A-Z]\.\s*){1,3}/.test(t)) score += 1;
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+\(\d{4}\)/.test(t)) score += 1;
  }

  const dynamicThreshold = Math.max(2, Math.min(threshold, Math.ceil(Math.max(nonEmpty, 1) * 0.2)));
  if (score >= dynamicThreshold) return true;

  const progress = headingEndOffset / Math.max(1, text.length);
  return progress >= 0.88 && nonEmpty >= 4 && score >= 2;
}

// ─── Bibliography / references truncation (Layer 1) ─────────────────────────
// Only truncates on HARD_STOP headings that pass heading validation AND
// reference-density confirmation. Searches from 20% into the document and
// picks the last confirmed match.

function stripTrailingSections(text: string): string {
  const minPosition = Math.floor(text.length * 0.2);
  let bestIndex = -1;

  const lines = text.split('\n');
  let offset = 0;
  for (const rawLine of lines) {
    const lineStart = offset;
    const lineEnd = lineStart + rawLine.length;
    offset = lineEnd + 1;

    if (lineStart < minPosition) continue;
    const heading = rawLine.trim();
    if (!heading) continue;
    if (!HARD_STOP_HEADING.test(heading)) continue;
    if (!isHeadingLike(heading)) continue;

    const headingEnd = Math.min(text.length, lineEnd + 1);
    if (confirmReferenceDensity(text, headingEnd)) {
      bestIndex = lineStart;
    }
  }

  if (bestIndex > minPosition) {
    const truncated = text.slice(0, bestIndex).trim();
    if (truncated.length > 500) return truncated;
  }
  return text;
}

// ─── Regex-based section heading detection ──────────────────────────────────

const HEADING_PATTERNS = [
  /^(\d+\.(?:\d+\.?)*)\s+(.+)/,                         // "1. Introduction", "2.1 Methods"
  /^(I{1,3}V?|VI{0,3}|IX|X{0,3})\.\s+(.+)/,            // "I. Introduction", "IV. Results"
  /^(ABSTRACT|INTRODUCTION|BACKGROUND|RELATED\s+WORK|LITERATURE\s+REVIEW|METHODOLOGY|METHODS?|MATERIALS?\s+AND\s+METHODS?|EXPERIMENT(?:AL)?(?:\s+SETUP)?|DATA(?:\s+(?:COLLECTION|SET|ANALYSIS))?|RESULTS?(?:\s+AND\s+DISCUSSION)?|DISCUSSION|ANALYSIS|EVALUATION|IMPLEMENTATION|FRAMEWORK|APPROACH|DESIGN|PROCEDURE|FINDINGS?|LIMITATIONS?|THREATS?\s+TO\s+VALIDITY|CONCLUSION|CONCLUSIONS?|SUMMARY|FUTURE\s+WORK|ACKNOWLEDG(?:E?MENT|MENT)S?|REFERENCES?|BIBLIOGRAPHY|WORKS?\s+CITED|LITERATURE\s+CITED|REFERENCE\s+LIST|REFERENCES?\s+AND\s+NOTES?|APPENDIX|APPENDICES)$/i,
];

const KNOWN_SECTION_KEYWORDS = /^(?:(?:section\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])\s*[.)\-:]?\s+)?(?:abstract|introduction|background|related\s+work|literature\s+review|theoretical\s+framework|research\s+design|methodology|methods?|materials?\s+and\s+methods?|participants?|sample|data\s+(?:collection|set|analysis)|experiment(?:al)?(?:\s+setup)?|results?(?:\s+and\s+discussion)?|discussion|analysis|evaluation|performance|comparison|implementation|framework|approach|design|procedure|findings?|limitations?|threats?\s+to\s+validity|conclusion|conclusions?\s+and\s+future\s+work|summary|future\s+work|acknowledg(?:e?ment|ment)s?|references?|bibliography|works?\s+cited|literature\s+cited|reference\s+list|references?\s+and\s+notes?|appendix|appendices)\s*$/i;

// DROP_SECTION_PATTERN kept as a union for backward-compat exports, but
// internal logic now uses HARD_STOP_HEADING / SOFT_DROP_HEADING exclusively.
const DROP_SECTION_PATTERN = /^(?:references?|bibliography|works?\s+cited|cited\s+literature|reference\s+list|literature\s+cited|references?\s+and\s+notes?|acknowledg(?:e?ment|ment)s?|author\s+biograph(?:y|ies))$/i;

function detectSections(fullText: string): PreparedPaperSection[] {
  const lines = fullText.split('\n');
  const headingIndices: Array<{ index: number; heading: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 120 || line.length < 3) continue;

    for (const pattern of HEADING_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const heading = match[2]
          ? match[2].trim().replace(/^\s*[:.\-–—]\s*/, '')
          : match[1]?.trim() || line;
        headingIndices.push({ index: i, heading: heading || line });
        break;
      }
    }

    if (headingIndices.length === 0 || headingIndices[headingIndices.length - 1]?.index !== i) {
      if (KNOWN_SECTION_KEYWORDS.test(line)) {
        const cleaned = line.replace(/^(?:(?:section\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])\s*[.)\-:]?\s+)/i, '').trim();
        headingIndices.push({ index: i, heading: cleaned || line });
      }
    }
  }

  if (headingIndices.length === 0) {
    if (fullText.length > 100) {
      return [{ heading: 'Body', text: fullText.trim() }];
    }
    return [];
  }

  const sections: PreparedPaperSection[] = [];

  if (headingIndices[0].index > 0) {
    const preamble = lines.slice(0, headingIndices[0].index).join('\n').trim();
    if (preamble.length > 50) {
      sections.push({ heading: 'Preamble', text: preamble });
    }
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const heading = headingIndices[h].heading;

    if (HARD_STOP_HEADING.test(heading)) break;
    if (SOFT_DROP_HEADING.test(heading)) continue;

    const start = headingIndices[h].index + 1;
    const end = h + 1 < headingIndices.length ? headingIndices[h + 1].index : lines.length;
    const text = lines.slice(start, end).join('\n').trim();

    if (text.length > 20) {
      sections.push({ heading, text });
    }
  }

  return sections;
}

/**
 * @deprecated Kept for backward compatibility with text-preparation-service.
 * Existing GROBID-parsed sectionsJson in the DB still works; this is only
 * needed if text-preparation-service encounters raw TEI XML (it won't with new docs).
 */
export function parseGrobidTeiToSections(_teiXml: string): PreparedPaperSection[] {
  return [];
}

// ─── Concurrency control ────────────────────────────────────────────────────

async function acquireSlot(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (STATE.inFlight >= PARSE_CONCURRENCY) {
    if (Date.now() > deadline) {
      STATE.inFlight = 0;
      STATE.waiters = [];
      break;
    }
    await new Promise<void>(resolve => { STATE.waiters.push(resolve); });
  }
  STATE.inFlight += 1;
}

function releaseSlot(): void {
  STATE.inFlight = Math.max(0, STATE.inFlight - 1);
  const next = STATE.waiters.shift();
  if (next) next();
}

// ─── Core document processor ───────────────────────────────────────────────

async function processDocument(documentId: string, attempt: number, source: string): Promise<boolean> {
  const doc = await prisma.referenceDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      status: true,
      storagePath: true,
      mimeType: true,
      parserUsed: true,
      sectionsJson: true,
      parsedText: true,
    },
  });

  if (!doc) {
    console.warn(`[ProactiveParsing] Document ${documentId} not found, skipping`);
    return false;
  }

  const hasStructuredParse = (doc.parserUsed === 'PDFJS' || doc.parserUsed === 'GROBID')
    && Array.isArray(doc.sectionsJson)
    && (doc.sectionsJson as unknown[]).length > 0;
  if (hasStructuredParse) return true;

  const mime = String(doc.mimeType || '').toLowerCase();
  const resolvedPath = resolveStoragePath(doc.storagePath);
  if (!mime.includes('pdf') || !resolvedPath || !fs.existsSync(resolvedPath)) {
    return false;
  }

  const allowedStatuses = new Set(['READY', 'UPLOADED', 'PARSING', 'FAILED']);
  if (!allowedStatuses.has(doc.status)) return false;

  console.log(`[ProactiveParsing] Processing ${documentId} via PDF.js (attempt ${attempt + 1}/${MAX_RETRIES}, source=${source})`);

  await prisma.referenceDocument.update({
    where: { id: documentId },
    data: { status: 'PARSING' },
  }).catch(() => undefined);

  await acquireSlot();
  try {
    const result = await extractTextWithPdfjs(resolvedPath);

    if (!result) {
      console.warn(`[ProactiveParsing] No text extracted for ${documentId}`);
      await prisma.referenceDocument.update({
        where: { id: documentId },
        data: { status: 'READY', errorCode: null },
      }).catch(() => undefined);
      return false;
    }

    const normalizedText = normalizeExtractedText(result.fullText);
    const sections = detectSections(normalizedText);
    const normalizedSections = sections
      .map(s => ({
        heading: sanitizeTextForPostgres(s.heading.trim()) || 'Untitled Section',
        text: normalizeExtractedText(s.text),
      }))
      .filter(s => s.text.length > 0);

    const sectionsPayload = normalizedSections.length > 0
      ? normalizedSections
      : [{ heading: 'Body', text: normalizedText }];
    const fullText = normalizedSections.length > 0
      ? normalizedSections.map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n').trim()
      : normalizedText;

    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: {
        sectionsJson: sanitizeForPostgres(sectionsPayload) as any,
        parsedText: sanitizeTextForPostgres(fullText),
        parserUsed: 'PDFJS',
        status: 'READY',
        pageCount: result.pages.length,
        errorCode: null,
      },
    });
    await pdfMatchVerificationService.verifyDocumentLinks(documentId, 'post-proactive');

    const tokenEstimate = Math.ceil(fullText.length / 4);
    console.log(`[ProactiveParsing] OK ${documentId}: ${sections.length} sections, ${result.pages.length} pages, ~${tokenEstimate} tokens`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ProactiveParsing] Error processing ${documentId}: ${msg}`);
    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: { status: 'READY', errorCode: null },
    }).catch(() => undefined);
    return false;
  } finally {
    releaseSlot();
  }
}

function resolveStoragePath(storagePath?: string | null): string | null {
  const candidate = String(storagePath || '').trim();
  if (!candidate) return null;
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

// ─── Queue processor (concurrent) ──────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (STATE.processing) {
    const elapsed = Date.now() - STATE.processingStartedAt;
    if (elapsed < PROCESSING_STALE_MS) return;
    console.warn(`[ProactiveParsing] Recovering stale processing lock (stuck for ${Math.round(elapsed / 1000)}s)`);
    STATE.processing = false;
    STATE.inFlight = 0;
    STATE.waiters = [];
  }

  STATE.processing = true;
  STATE.processingStartedAt = Date.now();

  try {
    while (STATE.queue.size > 0) {
      const batchSize = Math.min(STATE.queue.size, PARSE_CONCURRENCY);
      const entries = Array.from(STATE.queue.values())
        .sort((a, b) => a.addedAt - b.addedAt)
        .slice(0, batchSize);

      for (const e of entries) STATE.queue.delete(e.documentId);

      console.log(`[ProactiveParsing] Processing batch of ${entries.length} document(s): ${entries.map(e => e.documentId.slice(0, 8)).join(', ')}`);

      const results = await Promise.allSettled(
        entries.map(async (entry) => {
          const success = await processDocument(entry.documentId, entry.attempt, entry.source);
          return { entry, success };
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const { entry, success } = result.value;

        if (!success && entry.attempt < MAX_RETRIES - 1) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, entry.attempt);
          console.log(`[ProactiveParsing] Requeueing ${entry.documentId} in ${delayMs}ms (attempt ${entry.attempt + 1})`);

          setTimeout(() => {
            if (!STATE.queue.has(entry.documentId)) {
              STATE.queue.set(entry.documentId, {
                ...entry,
                attempt: entry.attempt + 1,
              });
              processQueue().catch(() => undefined);
            }
          }, delayMs);
        }
      }
    }
  } catch (error) {
    console.error('[ProactiveParsing] Queue processor error:', error);
  } finally {
    STATE.processing = false;
    STATE.processingStartedAt = 0;
  }
}

// ─── Public service ────────────────────────────────────────────────────────

class ProactiveParsingService {
  triggerForDocument(documentId: string, source = 'upload'): void {
    if (!documentId) return;
    if (STATE.queue.has(documentId)) return;

    STATE.queue.set(documentId, { documentId, attempt: 0, addedAt: Date.now(), source });
    console.log(`[ProactiveParsing] Queued ${documentId.slice(0, 8)} (source=${source}, queue=${STATE.queue.size})`);

    setImmediate(() => { processQueue().catch((err) => {
      console.error('[ProactiveParsing] processQueue error:', err);
    }); });
  }

  triggerForSessionCitations(
    sessionId: string,
    depthLabels: string[] = ['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST'],
    source = 'session'
  ): void {
    setImmediate(() => {
      this.enqueueSessionDocuments(sessionId, depthLabels, source).catch(error => {
        console.error(`[ProactiveParsing] Session trigger failed for ${sessionId}:`, error);
      });
    });
  }

  async enqueueSessionDocuments(
    sessionId: string,
    depthLabels: string[] = ['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST'],
    source = 'session'
  ): Promise<number> {
    const citations = await prisma.citation.findMany({
      where: { sessionId, isActive: true, libraryReferenceId: { not: null } },
      select: { libraryReferenceId: true, citationKey: true, deepAnalysisLabel: true, aiMeta: true },
    });

    const deepLabelsSet = new Set(depthLabels);
    const deepCitations = citations.filter(c => {
      if (c.deepAnalysisLabel && deepLabelsSet.has(c.deepAnalysisLabel)) return true;
      const rec = (c.aiMeta as any)?.deepAnalysisRecommendation;
      return typeof rec === 'string' && deepLabelsSet.has(rec);
    });

    if (deepCitations.length === 0) {
      console.log(`[ProactiveParsing] No DEEP_* citations for session ${sessionId} (${source})`);
      return 0;
    }

    const referenceIds = Array.from(
      new Set(deepCitations.map(c => c.libraryReferenceId).filter((id): id is string => Boolean(id)))
    );
    if (referenceIds.length === 0) return 0;

    const links = await prisma.referenceDocumentLink.findMany({
      where: { referenceId: { in: referenceIds }, isPrimary: true },
      select: { documentId: true },
    });
    const documentIds = Array.from(new Set(links.map(l => l.documentId)));

    const docs = await prisma.referenceDocument.findMany({
      where: {
        id: { in: documentIds },
        OR: [
          { parserUsed: null },
          { sectionsJson: { equals: null as any } },
        ],
      },
      select: { id: true, status: true },
    });

    const allowedStatuses = new Set(['READY', 'UPLOADED', 'FAILED', 'PARSING']);
    const eligible = docs.filter(d => allowedStatuses.has(d.status));
    if (eligible.length === 0) {
      const alreadyParsed = documentIds.length - docs.length;
      if (alreadyParsed > 0) {
        console.log(`[ProactiveParsing] All ${alreadyParsed} document(s) already parsed for session ${sessionId}`);
      } else {
        console.log(`[ProactiveParsing] No eligible PDFs for ${deepCitations.length} DEEP citations in session ${sessionId}`);
      }
      return 0;
    }

    console.log(`[ProactiveParsing] Queueing ${eligible.length}/${deepCitations.length} document(s) for PDF.js parsing (session=${sessionId}, source=${source})`);

    for (const doc of eligible) {
      if (!STATE.queue.has(doc.id)) {
        STATE.queue.set(doc.id, { documentId: doc.id, attempt: 0, addedAt: Date.now(), source });
      }
    }

    setImmediate(() => { processQueue().catch((err) => {
      console.error('[ProactiveParsing] processQueue error after enqueue:', err);
    }); });

    return eligible.length;
  }

  triggerForCitations(citationIds: string[], source = 'classification'): void {
    if (!citationIds.length) return;

    setImmediate(async () => {
      try {
        const citations = await prisma.citation.findMany({
          where: { id: { in: citationIds }, isActive: true, libraryReferenceId: { not: null } },
          select: { libraryReferenceId: true },
        });

        const referenceIds = Array.from(
          new Set(citations.map(c => c.libraryReferenceId).filter((id): id is string => Boolean(id)))
        );
        if (referenceIds.length === 0) return;

        const links = await prisma.referenceDocumentLink.findMany({
          where: { referenceId: { in: referenceIds }, isPrimary: true },
          select: { documentId: true },
        });
        const documentIds = Array.from(new Set(links.map(l => l.documentId)));

        const docs = await prisma.referenceDocument.findMany({
          where: {
            id: { in: documentIds },
            OR: [
              { parserUsed: { not: 'PDFJS' } },
              { parserUsed: null },
              { sectionsJson: { equals: null as any } },
            ],
          },
          select: { id: true, status: true },
        });

        const citAllowed = new Set(['READY', 'UPLOADED', 'FAILED', 'PARSING']);
        const eligible = docs.filter(d => citAllowed.has(d.status));
        if (eligible.length > 0) {
          console.log(`[ProactiveParsing] Queueing ${eligible.length} documents from ${citationIds.length} citations (${source})`);
          for (const doc of eligible) {
            this.triggerForDocument(doc.id, source);
          }
        }
      } catch (error) {
        console.error(`[ProactiveParsing] Citation trigger failed:`, error);
      }
    });
  }

  getQueueDepth(): number { return STATE.queue.size; }
  getInFlight(): number { return STATE.inFlight; }

  resetIfStuck(): void {
    if (!STATE.processing) return;
    const elapsed = Date.now() - STATE.processingStartedAt;
    console.warn(`[ProactiveParsing] Force-resetting processing lock (${Math.round(elapsed / 1000)}s, inFlight=${STATE.inFlight}, queue=${STATE.queue.size})`);
    STATE.processing = false;
    STATE.processingStartedAt = 0;
    STATE.inFlight = 0;
    STATE.waiters = [];
  }

  getDiagnostics() {
    return {
      queueSize: STATE.queue.size,
      inFlight: STATE.inFlight,
      processing: STATE.processing,
      processingForMs: STATE.processing ? Date.now() - STATE.processingStartedAt : 0,
      queuedDocIds: Array.from(STATE.queue.keys()).map(id => id.slice(0, 8)),
    };
  }
}

export {
  detectSections,
  normalizeExtractedText,
  reconstructPageText,
  stripTrailingSections,
  HARD_STOP_HEADING,
  SOFT_DROP_HEADING,
  isHeadingLike,
  confirmReferenceDensity,
};
export type { TextItem };
export const proactiveParsingService = new ProactiveParsingService();
export { ProactiveParsingService };
