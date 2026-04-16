/**
 * Reference Import Service
 * Parses and imports references from various formats:
 * - BibTeX (.bib)
 * - RIS (EndNote, Mendeley, Zotero exports)
 * - CSV (custom format)
 * - JSON (Mendeley/Zotero API exports)
 */

import { CitationImportSource, CitationSourceType } from '@prisma/client';

export interface ParsedReference {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  editors?: string[];
  publicationPlace?: string;
  publicationDate?: string;
  accessedDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  abstract?: string;
  sourceType: CitationSourceType;
  importSource: CitationImportSource;
  citationKey?: string;
  bibtex?: string;
  externalId?: string;
  tags?: string[];
  notes?: string;
  attachmentHints?: string[];
}

export interface ImportResult {
  success: boolean;
  references: ParsedReference[];
  errors: string[];
  warnings: string[];
  format: string;
}

// ============================================================================
// BIBTEX PARSER
// ============================================================================

const BIBTEX_TYPE_MAP: Record<string, CitationSourceType> = {
  article: 'JOURNAL_ARTICLE',
  inproceedings: 'CONFERENCE_PAPER',
  conference: 'CONFERENCE_PAPER',
  book: 'BOOK',
  inbook: 'BOOK_CHAPTER',
  incollection: 'BOOK_CHAPTER',
  phdthesis: 'THESIS',
  mastersthesis: 'THESIS',
  techreport: 'REPORT',
  misc: 'OTHER',
  unpublished: 'WORKING_PAPER',
  online: 'WEBSITE',
  patent: 'PATENT',
};

// Maximum number of references to parse (prevent memory issues with huge files)
const MAX_REFERENCES = 5000;

function isLikelyPdfPointer(value: string | undefined): boolean {
  if (!value) return false;
  return /\.pdf(?:$|[?#])/i.test(value) || /(?:^|[:\s])pdf(?:$|[:\s])/i.test(value);
}

function normalizeAttachmentHint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let normalized = value
    .trim()
    .replace(/^\{+|\}+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/^file:\/\//i, '')
    .replace(/\|.*$/g, '')
    .replace(/:pdf$/i, '')
    .replace(/^:/, '')
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0]
    .trim();

  if (!normalized) return undefined;

  // Mendeley/EndNote style values can contain leading metadata tokens separated by ":".
  if (!normalized.toLowerCase().includes('.pdf') && normalized.includes(':')) {
    const tail = normalized.split(':').pop();
    if (tail) normalized = tail.trim();
  }

  return normalized || undefined;
}

function extractAttachmentHints(...values: Array<string | undefined>): string[] {
  const hints = new Set<string>();

  for (const value of values) {
    if (!value) continue;

    for (const segment of value.split(/\r?\n|;|\|/)) {
      const normalized = normalizeAttachmentHint(segment);
      if (!normalized) continue;
      if (!isLikelyPdfPointer(normalized)) continue;

      hints.add(normalized);
      const baseName = normalized.split('/').pop();
      if (baseName && baseName !== normalized) {
        hints.add(baseName);
      }
    }
  }

  return Array.from(hints).slice(0, 20);
}

type ParsedBibTeXEntry = {
  entryType: string;
  citationKey: string;
  fieldsString: string;
  rawEntry: string;
};

function findMatchingDelimiter(input: string, startIndex: number, openChar: '{' | '(', closeChar: '}' | ')'): number {
  let depth = 0;
  let inQuotes = false;
  let escaped = false;

  for (let i = startIndex; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;

    if (ch === openChar) {
      depth += 1;
      continue;
    }
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitBibTeXEntryContent(content: string): { citationKey: string; fieldsString: string } | null {
  let depthBrace = 0;
  let depthParen = 0;
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;

    if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === ',' && depthBrace === 0 && depthParen === 0) {
      return {
        citationKey: content.slice(0, i).trim(),
        fieldsString: content.slice(i + 1),
      };
    }
  }

  return null;
}

function parseBibTeXEntries(input: string, warnings: string[]): ParsedBibTeXEntry[] {
  const entries: ParsedBibTeXEntry[] = [];
  let index = 0;

  while (index < input.length) {
    const atIndex = input.indexOf('@', index);
    if (atIndex < 0) break;

    let cursor = atIndex + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;

    const typeStart = cursor;
    while (cursor < input.length && /[a-z0-9_]/i.test(input[cursor])) cursor += 1;
    const entryType = input.slice(typeStart, cursor).trim().toLowerCase();
    if (!entryType) {
      index = atIndex + 1;
      continue;
    }

    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    const openChar = input[cursor];
    if (openChar !== '{' && openChar !== '(') {
      index = atIndex + 1;
      continue;
    }

    const closeChar = openChar === '{' ? '}' : ')';
    const closingIndex = findMatchingDelimiter(input, cursor, openChar, closeChar);
    if (closingIndex < 0) {
      warnings.push(`Unterminated BibTeX entry starting near index ${atIndex}`);
      break;
    }

    const content = input.slice(cursor + 1, closingIndex).trim();
    const split = splitBibTeXEntryContent(content);
    if (split && split.citationKey) {
      entries.push({
        entryType,
        citationKey: split.citationKey,
        fieldsString: split.fieldsString,
        rawEntry: input.slice(atIndex, closingIndex + 1),
      });
    }

    index = closingIndex + 1;
  }

  return entries;
}

function splitBibTeXConcatenatedValue(value: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;

    if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '#' && depthBrace === 0 && depthParen === 0) {
      segments.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  segments.push(value.slice(start).trim());
  return segments.filter(Boolean);
}

function unwrapBibTeXFieldSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeBibTeXFieldValue(rawValue: string): string {
  const parts = splitBibTeXConcatenatedValue(rawValue)
    .map((part) => unwrapBibTeXFieldSegment(part))
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function parseBibTeX(bibtexString: string): ImportResult {
  const references: ParsedReference[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate input
  if (!bibtexString || typeof bibtexString !== 'string') {
    return { success: false, references: [], errors: ['Invalid input'], warnings: [], format: 'bibtex' };
  }

  const entries = parseBibTeXEntries(bibtexString, warnings);
  let count = 0;

  for (const entry of entries) {
    // Limit to prevent memory issues
    if (count >= MAX_REFERENCES) {
      warnings.push(`Import limited to ${MAX_REFERENCES} references`);
      break;
    }
    count++;

    try {
      const entryType = entry.entryType;
      const citationKey = entry.citationKey.trim();
      const fieldsString = entry.fieldsString;

      // Parse fields
      const fields = parseBibTeXFields(fieldsString);

      // Parse year safely
      let year: number | undefined;
      if (fields.year) {
        const parsedYear = parseInt(fields.year, 10);
        if (!isNaN(parsedYear) && parsedYear > 1000 && parsedYear < 3000) {
          year = parsedYear;
        }
      }

      const ref: ParsedReference = {
        title: cleanBibTeXValue(fields.title || ''),
        authors: parseBibTeXAuthors(fields.author || ''),
        year,
        venue: cleanBibTeXValue(fields.journal || fields.booktitle || fields.howpublished || ''),
        volume: fields.volume || undefined,
        issue: fields.number || undefined,
        pages: fields.pages || undefined,
        doi: cleanBibTeXValue(fields.doi || '') || undefined,
        url: cleanBibTeXValue(fields.url || '') || undefined,
        isbn: cleanBibTeXValue(fields.isbn || '') || undefined,
        publisher: cleanBibTeXValue(fields.publisher || '') || undefined,
        edition: fields.edition || undefined,
        editors: parseBibTeXAuthors(fields.editor || ''),
        publicationPlace: cleanBibTeXValue(fields.address || fields.location || '') || undefined,
        publicationDate: cleanBibTeXValue(fields.date || '') || undefined,
        accessedDate: cleanBibTeXValue(fields.urldate || fields.accessed || '') || undefined,
        articleNumber: cleanBibTeXValue(fields['article-number'] || fields.articlenumber || '') || undefined,
        issn: cleanBibTeXValue(fields.issn || '') || undefined,
        journalAbbreviation: cleanBibTeXValue(fields.shortjournal || fields.journalabbr || '') || undefined,
        pmid: cleanBibTeXValue(fields.pmid || '') || undefined,
        pmcid: cleanBibTeXValue(fields.pmcid || fields.pmc || '') || undefined,
        arxivId: cleanBibTeXValue(fields.eprint || fields.arxivid || '') || undefined,
        abstract: cleanBibTeXValue(fields.abstract || '') || undefined,
        sourceType: BIBTEX_TYPE_MAP[entryType] || 'OTHER',
        importSource: 'BIBTEX_IMPORT',
        citationKey: citationKey || undefined,
        bibtex: entry.rawEntry,
        tags: fields.keywords ? fields.keywords.split(/[,;]/).map(k => k.trim()).filter(Boolean) : [],
        notes: cleanBibTeXValue(fields.note || fields.annote || '') || undefined,
        attachmentHints: extractAttachmentHints(
          fields.file,
          fields.pdf,
          fields.localfile,
          fields['local-url'],
          isLikelyPdfPointer(fields.url || '') ? fields.url : undefined
        ),
      };

      if (ref.title) {
        references.push(ref);
      } else {
        warnings.push(`Entry "${citationKey || 'unknown'}" has no title, skipped`);
      }
    } catch (err) {
      errors.push(`Failed to parse entry: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return {
    success: errors.length === 0,
    references,
    errors,
    warnings,
    format: 'bibtex',
  };
}

function parseBibTeXFields(fieldsString: string): Record<string, string> {
  const fields: Record<string, string> = {};

  let index = 0;
  const input = String(fieldsString || '');

  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index])) index += 1;
    if (index >= input.length) break;

    const keyStart = index;
    while (index < input.length && /[\w-]/.test(input[index])) index += 1;
    const key = input.slice(keyStart, index).trim().toLowerCase();
    if (!key) {
      index += 1;
      continue;
    }

    while (index < input.length && /\s/.test(input[index])) index += 1;
    if (input[index] !== '=') {
      while (index < input.length && input[index] !== ',') index += 1;
      continue;
    }

    index += 1; // skip "="
    while (index < input.length && /\s/.test(input[index])) index += 1;
    const valueStart = index;

    let depthBrace = 0;
    let depthParen = 0;
    let inQuotes = false;
    let escaped = false;

    while (index < input.length) {
      const ch = input[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        index += 1;
        continue;
      }
      if (!inQuotes) {
        if (ch === '{') depthBrace += 1;
        else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
        else if (ch === '(') depthParen += 1;
        else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
        else if (ch === ',' && depthBrace === 0 && depthParen === 0) {
          break;
        }
      }
      index += 1;
    }

    const rawValue = input.slice(valueStart, index).trim();
    fields[key] = normalizeBibTeXFieldValue(rawValue);

    if (input[index] === ',') index += 1;
  }

  return fields;
}

function parseBibTeXAuthors(authorString: string): string[] {
  if (!authorString) return [];
  
  // Authors are separated by " and "
  return authorString
    .split(/\s+and\s+/i)
    .map(author => {
      // Handle "Last, First" format
      const parts = author.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        return `${parts[1]} ${parts[0]}`.trim();
      }
      return author.trim();
    })
    .filter(Boolean);
}

function cleanBibTeXValue(value: string): string {
  return value
    .replace(/\{|\}/g, '') // Remove braces
    .replace(/\\&/g, '&')
    .replace(/\\\$/g, '$')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\\/g, '\\')
    .replace(/``|''/g, '"')
    .replace(/`|'/g, "'")
    .replace(/\\textendash/g, '–')
    .replace(/\\textemdash/g, '—')
    .replace(/~+/g, ' ')
    .trim();
}

// ============================================================================
// RIS PARSER (EndNote, Mendeley, Zotero exports)
// ============================================================================

const RIS_TYPE_MAP: Record<string, CitationSourceType> = {
  JOUR: 'JOURNAL_ARTICLE',
  JFULL: 'JOURNAL_ARTICLE',
  ABST: 'JOURNAL_ARTICLE',
  CONF: 'CONFERENCE_PAPER',
  CPAPER: 'CONFERENCE_PAPER',
  BOOK: 'BOOK',
  CHAP: 'BOOK_CHAPTER',
  THES: 'THESIS',
  RPRT: 'REPORT',
  GEN: 'OTHER',
  ELEC: 'WEBSITE',
  ICOMM: 'WEBSITE',
  PAT: 'PATENT',
  UNPB: 'WORKING_PAPER',
};

export function parseRIS(risString: string): ImportResult {
  const references: ParsedReference[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate input
  if (!risString || typeof risString !== 'string') {
    return { success: false, references: [], errors: ['Invalid input'], warnings: [], format: 'ris' };
  }

  // Split into individual records
  const records = risString.split(/ER\s*-/).filter(r => r.trim());

  // Limit number of records
  const limitedRecords = records.slice(0, MAX_REFERENCES);
  if (records.length > MAX_REFERENCES) {
    warnings.push(`Import limited to ${MAX_REFERENCES} references`);
  }

  for (const record of limitedRecords) {
    try {
      const fields = parseRISFields(record);
      
      if (!fields.TY || !fields.TY[0]) continue; // Skip invalid records

      const authors = [
        ...(fields.AU || []),
        ...(fields.A1 || []),
        ...(fields.A2 || []),
      ].map(a => a.replace(/,\s*/g, ' ').trim()).filter(Boolean);

      // Parse year safely
      let year: number | undefined;
      const yearStr = fields.PY?.[0] || fields.Y1?.[0];
      if (yearStr) {
        const parsedYear = parseInt(yearStr.split('/')[0], 10);
        if (!isNaN(parsedYear) && parsedYear > 1000 && parsedYear < 3000) {
          year = parsedYear;
        }
      }

      const ref: ParsedReference = {
        title: fields.TI?.[0] || fields.T1?.[0] || fields.CT?.[0] || '',
        authors: authors,
        year,
        venue: fields.JO?.[0] || fields.JF?.[0] || fields.T2?.[0] || fields.BT?.[0] || undefined,
        volume: fields.VL?.[0] || undefined,
        issue: fields.IS?.[0] || undefined,
        pages: fields.SP?.[0] && fields.EP?.[0] ? `${fields.SP[0]}-${fields.EP[0]}` : fields.SP?.[0] || undefined,
        doi: extractDOI(fields.DO?.[0] || fields.M3?.[0] || ''),
        url: fields.UR?.[0] || fields.L1?.[0] || fields.L2?.[0] || undefined,
        isbn: fields.SN?.[0] || undefined,
        issn: fields.SN?.[0] || undefined,
        publisher: fields.PB?.[0] || undefined,
        publicationPlace: fields.CY?.[0] || undefined,
        publicationDate: fields.Y1?.[0] || fields.PY?.[0] || undefined,
        pmid: fields.AN?.[0] || undefined,
        abstract: fields.AB?.[0] || fields.N2?.[0] || undefined,
        sourceType: RIS_TYPE_MAP[fields.TY[0]] || 'OTHER',
        importSource: 'RIS_IMPORT',
        externalId: fields.ID?.[0] || undefined,
        tags: fields.KW || [],
        notes: fields.N1?.[0] || undefined,
        attachmentHints: extractAttachmentHints(
          ...(fields.L1 || []),
          ...(fields.L2 || []),
          ...(fields.L4 || []),
          ...(fields.UR || []).filter((value) => isLikelyPdfPointer(value))
        ),
      };

      if (ref.title) {
        references.push(ref);
      } else {
        warnings.push('Record with no title skipped');
      }
    } catch (err) {
      errors.push(`Failed to parse RIS record: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return {
    success: errors.length === 0,
    references,
    errors,
    warnings,
    format: 'ris',
  };
}

function parseRISFields(record: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  const lines = record.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9])\s*-\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      if (!fields[key]) fields[key] = [];
      fields[key].push(value);
    }
  }

  return fields;
}

function extractDOI(value: string): string | undefined {
  if (!value) return undefined;
  const doiMatch = value.match(/10\.\d{4,}\/[^\s]+/);
  return doiMatch ? doiMatch[0] : undefined;
}

// ============================================================================
// MENDELEY JSON PARSER
// ============================================================================

export function parseMendeleyJSON(jsonString: string): ImportResult {
  const references: ParsedReference[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate input
  if (!jsonString || typeof jsonString !== 'string') {
    return { success: false, references: [], errors: ['Invalid input'], warnings: [], format: 'mendeley_json' };
  }

  try {
    const data = JSON.parse(jsonString);
    const items = Array.isArray(data) ? data : data.documents || data.items || [data];

    // Limit number of items
    const limitedItems = items.slice(0, MAX_REFERENCES);
    if (items.length > MAX_REFERENCES) {
      warnings.push(`Import limited to ${MAX_REFERENCES} references`);
    }

    for (const item of limitedItems) {
      if (!item || typeof item !== 'object') continue;

      try {
        // Parse year safely
        let year: number | undefined;
        const yearValue = item.year || item.issued?.['date-parts']?.[0]?.[0];
        if (yearValue !== undefined && yearValue !== null) {
          const parsedYear = typeof yearValue === 'number' ? yearValue : parseInt(String(yearValue), 10);
          if (!isNaN(parsedYear) && parsedYear > 1000 && parsedYear < 3000) {
            year = parsedYear;
          }
        }

        const ref: ParsedReference = {
          title: String(item.title || ''),
          authors: (Array.isArray(item.authors) ? item.authors : []).map((a: any) => {
            if (typeof a === 'string') return a;
            if (typeof a !== 'object' || !a) return '';
            return `${a.first_name || a.firstName || ''} ${a.last_name || a.lastName || ''}`.trim() ||
              a.name || '';
          }).filter(Boolean),
          year,
          venue: String(item.source || item.journal || item['container-title'] || '') || undefined,
          volume: item.volume?.toString() || undefined,
          issue: item.issue?.toString() || undefined,
          pages: String(item.pages || '') || undefined,
          doi: String(item.identifiers?.doi || item.doi || item.DOI || '') || undefined,
          url: String(item.websites?.[0] || item.url || item.URL || '') || undefined,
          isbn: String(item.identifiers?.isbn || item.isbn || item.ISBN || '') || undefined,
          issn: String(item.identifiers?.issn || item.issn || item.ISSN || '') || undefined,
          publisher: String(item.publisher || '') || undefined,
          publicationPlace: String(item.city || item.place || '') || undefined,
          publicationDate: String(item.date || '') || undefined,
          articleNumber: String(item.article_number || item.articleNumber || '') || undefined,
          pmid: String(item.identifiers?.pmid || item.pmid || '') || undefined,
          pmcid: String(item.identifiers?.pmcid || item.pmcid || '') || undefined,
          arxivId: String(item.identifiers?.arxiv || item.arxiv || item.arxivId || '') || undefined,
          abstract: String(item.abstract || '') || undefined,
          sourceType: mapMendeleyType(item.type),
          importSource: 'MENDELEY_IMPORT',
          externalId: String(item.id || item.uuid || '') || undefined,
          tags: (Array.isArray(item.tags) ? item.tags : Array.isArray(item.keywords) ? item.keywords : [])
            .map((t: any) => typeof t === 'string' ? t : (t?.name || ''))
            .filter(Boolean),
          notes: String(item.notes || '') || undefined,
          attachmentHints: extractAttachmentHints(
            ...(Array.isArray(item.files)
              ? item.files.flatMap((file: any) => [
                  typeof file?.file_name === 'string' ? file.file_name : undefined,
                  typeof file?.fileName === 'string' ? file.fileName : undefined,
                  typeof file?.path === 'string' ? file.path : undefined,
                  typeof file?.url === 'string' ? file.url : undefined,
                  typeof file?.download_url === 'string' ? file.download_url : undefined,
                ])
              : [])
          ),
        };

        if (ref.title) {
          references.push(ref);
        }
      } catch (err) {
        errors.push(`Failed to parse Mendeley item: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } catch (err) {
    errors.push(`Invalid JSON format: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return {
    success: errors.length === 0,
    references,
    errors,
    warnings,
    format: 'mendeley_json',
  };
}

function mapMendeleyType(type: string | undefined): CitationSourceType {
  if (!type) return 'OTHER';
  const typeMap: Record<string, CitationSourceType> = {
    'journal': 'JOURNAL_ARTICLE',
    'article': 'JOURNAL_ARTICLE',
    'conference_proceedings': 'CONFERENCE_PAPER',
    'conference': 'CONFERENCE_PAPER',
    'book': 'BOOK',
    'book_section': 'BOOK_CHAPTER',
    'thesis': 'THESIS',
    'report': 'REPORT',
    'web_page': 'WEBSITE',
    'patent': 'PATENT',
    'working_paper': 'WORKING_PAPER',
  };
  return typeMap[type.toLowerCase()] || 'OTHER';
}

// ============================================================================
// ZOTERO CSL-JSON PARSER
// ============================================================================

export function parseZoteroCSLJSON(jsonString: string): ImportResult {
  const references: ParsedReference[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate input
  if (!jsonString || typeof jsonString !== 'string') {
    return { success: false, references: [], errors: ['Invalid input'], warnings: [], format: 'zotero_csl_json' };
  }

  try {
    const data = JSON.parse(jsonString);
    const items = Array.isArray(data) ? data : [data];

    // Limit number of items
    const limitedItems = items.slice(0, MAX_REFERENCES);
    if (items.length > MAX_REFERENCES) {
      warnings.push(`Import limited to ${MAX_REFERENCES} references`);
    }

    for (const item of limitedItems) {
      if (!item || typeof item !== 'object') continue;

      try {
        const authors = (Array.isArray(item.author) ? item.author : []).map((a: any) => {
          if (typeof a === 'string') return a;
          if (typeof a !== 'object' || !a) return '';
          return `${a.given || ''} ${a.family || ''}`.trim() || a.literal || '';
        }).filter(Boolean);

        // Parse year safely
        let year: number | undefined;
        const yearValue = item.issued?.['date-parts']?.[0]?.[0];
        if (yearValue !== undefined && yearValue !== null) {
          const parsedYear = typeof yearValue === 'number' ? yearValue : parseInt(String(yearValue), 10);
          if (!isNaN(parsedYear) && parsedYear > 1000 && parsedYear < 3000) {
            year = parsedYear;
          }
        }

        const ref: ParsedReference = {
          title: String(item.title || ''),
          authors,
          year,
          venue: String(item['container-title'] || item.publisher || '') || undefined,
          volume: item.volume?.toString() || undefined,
          issue: item.issue?.toString() || undefined,
          pages: String(item.page || '') || undefined,
          doi: String(item.DOI || '') || undefined,
          url: String(item.URL || '') || undefined,
          isbn: String(item.ISBN || '') || undefined,
          issn: String(item.ISSN || '') || undefined,
          publisher: String(item.publisher || '') || undefined,
          publicationPlace: String(item['publisher-place'] || item.eventPlace || '') || undefined,
          publicationDate: String(item.issued?.raw || '') || undefined,
          articleNumber: String(item['article-number'] || '') || undefined,
          journalAbbreviation: String(item['container-title-short'] || item['short-container-title'] || '') || undefined,
          pmid: String(item.PMID || item.pmid || '') || undefined,
          pmcid: String(item.PMCID || item.pmcid || '') || undefined,
          arxivId: String(item.arXiv || item.arxiv || item.arxivId || '') || undefined,
          abstract: String(item.abstract || '') || undefined,
          sourceType: mapCSLType(item.type),
          importSource: 'ZOTERO_IMPORT',
          externalId: String(item.id || '') || undefined,
          tags: [],
          notes: String(item.note || '') || undefined,
          attachmentHints: extractAttachmentHints(
            ...(Array.isArray((item as any).attachments)
              ? (item as any).attachments.flatMap((attachment: any) => [
                  typeof attachment?.path === 'string' ? attachment.path : undefined,
                  typeof attachment?.title === 'string' ? attachment.title : undefined,
                  typeof attachment?.url === 'string' ? attachment.url : undefined,
                ])
              : [])
          ),
        };

        if (ref.title) {
          references.push(ref);
        }
      } catch (err) {
        errors.push(`Failed to parse Zotero item: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } catch (err) {
    errors.push(`Invalid JSON format: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return {
    success: errors.length === 0,
    references,
    errors,
    warnings,
    format: 'zotero_csl_json',
  };
}

function mapCSLType(type: string | undefined): CitationSourceType {
  if (!type) return 'OTHER';
  const typeMap: Record<string, CitationSourceType> = {
    'article-journal': 'JOURNAL_ARTICLE',
    'article': 'JOURNAL_ARTICLE',
    'paper-conference': 'CONFERENCE_PAPER',
    'book': 'BOOK',
    'chapter': 'BOOK_CHAPTER',
    'thesis': 'THESIS',
    'report': 'REPORT',
    'webpage': 'WEBSITE',
    'patent': 'PATENT',
  };
  return typeMap[type.toLowerCase()] || 'OTHER';
}

// ============================================================================
// AUTO-DETECT AND PARSE
// ============================================================================

export function detectFormatAndParse(content: string): ImportResult {
  const trimmed = content.trim();

  // Check for BibTeX format
  if (trimmed.startsWith('@') || /@\w+\s*\{/.test(trimmed)) {
    return parseBibTeX(content);
  }

  // Check for RIS format
  if (/^TY\s+-/m.test(trimmed)) {
    return parseRIS(content);
  }

  // Try JSON formats
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      
      // Check for Mendeley format
      if (data.documents || (Array.isArray(data) && data[0]?.identifiers)) {
        return parseMendeleyJSON(content);
      }
      
      // Check for CSL-JSON (Zotero)
      if (Array.isArray(data) && data[0]?.type) {
        return parseZoteroCSLJSON(content);
      }

      // Generic JSON with references
      if (data.references || data.items) {
        return parseMendeleyJSON(content);
      }

      // Try CSL-JSON as fallback
      return parseZoteroCSLJSON(content);
    } catch {
      return {
        success: false,
        references: [],
        errors: ['Invalid JSON format'],
        warnings: [],
        format: 'unknown',
      };
    }
  }

  return {
    success: false,
    references: [],
    errors: ['Unable to detect reference format. Supported formats: BibTeX, RIS, Mendeley JSON, Zotero CSL-JSON'],
    warnings: [],
    format: 'unknown',
  };
}

// ============================================================================
// EXPORT TO BIBTEX
// ============================================================================

export function exportToBibTeX(references: ParsedReference[]): string {
  return references.map(ref => {
    const typeMap: Record<CitationSourceType, string> = {
      JOURNAL_ARTICLE: 'article',
      CONFERENCE_PAPER: 'inproceedings',
      BOOK: 'book',
      BOOK_CHAPTER: 'incollection',
      THESIS: 'phdthesis',
      REPORT: 'techreport',
      WEBSITE: 'misc',
      PATENT: 'patent',
      WORKING_PAPER: 'unpublished',
      OTHER: 'misc',
    };

    const entryType = typeMap[ref.sourceType] || 'misc';
    const key = ref.citationKey || generateCitationKey(ref);

    const fields: string[] = [];
    
    if (ref.title) fields.push(`  title = {${escapeBibTeX(ref.title)}}`);
    if (ref.authors.length > 0) fields.push(`  author = {${ref.authors.join(' and ')}}`);
    if (ref.year) fields.push(`  year = {${ref.year}}`);
    if (ref.venue) {
      const fieldName = ref.sourceType === 'JOURNAL_ARTICLE' ? 'journal' : 'booktitle';
      fields.push(`  ${fieldName} = {${escapeBibTeX(ref.venue)}}`);
    }
    if (ref.volume) fields.push(`  volume = {${ref.volume}}`);
    if (ref.issue) fields.push(`  number = {${ref.issue}}`);
    if (ref.pages) fields.push(`  pages = {${ref.pages}}`);
    if (ref.doi) fields.push(`  doi = {${ref.doi}}`);
    if (ref.url) fields.push(`  url = {${ref.url}}`);
    if (ref.isbn) fields.push(`  isbn = {${ref.isbn}}`);
    if (ref.issn) fields.push(`  issn = {${ref.issn}}`);
    if (ref.publisher) fields.push(`  publisher = {${escapeBibTeX(ref.publisher)}}`);
    if (ref.editors && ref.editors.length > 0) fields.push(`  editor = {${ref.editors.join(' and ')}}`);
    if (ref.publicationPlace) fields.push(`  address = {${escapeBibTeX(ref.publicationPlace)}}`);
    if (ref.articleNumber) fields.push(`  article-number = {${ref.articleNumber}}`);
    if (ref.journalAbbreviation) fields.push(`  shortjournal = {${escapeBibTeX(ref.journalAbbreviation)}}`);
    if (ref.pmid) fields.push(`  pmid = {${ref.pmid}}`);
    if (ref.pmcid) fields.push(`  pmcid = {${ref.pmcid}}`);
    if (ref.arxivId) {
      fields.push(`  eprint = {${ref.arxivId}}`);
      fields.push(`  archivePrefix = {arXiv}`);
    }
    if (ref.abstract) fields.push(`  abstract = {${escapeBibTeX(ref.abstract)}}`);

    return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
  }).join('\n\n');
}

function escapeBibTeX(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$');
}

function generateCitationKey(ref: ParsedReference): string {
  const firstAuthor = ref.authors[0]?.split(' ').pop() || 'Unknown';
  const year = ref.year || 'nd';
  const titleWord = ref.title.split(' ')[0]?.toLowerCase() || '';
  return `${firstAuthor}${year}${titleWord}`.replace(/[^a-zA-Z0-9]/g, '');
}

