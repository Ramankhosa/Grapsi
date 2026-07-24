import AdmZip from 'adm-zip';

/**
 * Minimal CSV / XLSX reader for flat, text-only uploads (e.g. a faculty roster).
 *
 * An .xlsx file is just a ZIP of XML parts, and the repo already depends on
 * adm-zip, so reading one needs no extra dependency. This deliberately supports
 * only what a roster needs — the first worksheet, cell text, shared strings and
 * inline strings. Formulas resolve to their cached value; number formats and
 * date serials are returned raw, which is fine because every roster column is
 * text.
 */

export interface ParsedSheet {
  /** Header labels exactly as they appeared in the first row. */
  headers: string[];
  /** One entry per data row, keyed by the normalized header name. */
  rows: Array<Record<string, string>>;
}

const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];

/** Header lookup key: lowercase alphanumerics only, so "Research Areas",
 *  "research_areas" and "ResearchAreas" all collapse to "researchareas". */
export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    // & must be decoded last so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&');
}

/** "AB" -> 27 (zero-based column index). */
function columnIndexFromRef(ref: string) {
  const letters = (ref.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Concatenates every <t> run inside a fragment (rich text splits one string
 *  across several runs). */
function readTextRuns(fragment: string) {
  const runRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let text = '';
  let match: RegExpExecArray | null;
  while ((match = runRegex.exec(fragment)) !== null) {
    text += match[1];
  }
  return decodeXmlEntities(text);
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    strings.push(readTextRuns(match[1]));
  }
  return strings;
}

function parseWorksheet(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const refMatch = attributes.match(/\br="([A-Za-z]+)\d+"/);
      const columnIndex = refMatch ? columnIndexFromRef(refMatch[1]) : cells.length;
      const typeMatch = attributes.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';

      let value = '';
      if (cellType === 'inlineStr') {
        value = readTextRuns(body);
      } else {
        const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = valueMatch ? decodeXmlEntities(valueMatch[1]) : '';
        if (cellType === 's') {
          const index = Number(raw);
          value = Number.isInteger(index) && sharedStrings[index] !== undefined ? sharedStrings[index] : '';
        } else if (cellType === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = raw;
        }
      }

      // Cells are sparse — pad up to the cell's actual column.
      while (cells.length < columnIndex) {
        cells.push('');
      }
      cells[columnIndex] = value;
    }

    rows.push(cells);
  }

  return rows;
}

/** Resolves the workbook's *first* sheet, which is not always sheet1.xml. */
function resolveFirstWorksheetPath(zip: AdmZip) {
  const workbook = zip.getEntry('xl/workbook.xml')?.getData().toString('utf8');
  const rels = zip.getEntry('xl/_rels/workbook.xml.rels')?.getData().toString('utf8');

  if (workbook && rels) {
    const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    if (firstSheet) {
      const relRegex = new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheet[1]}"[^>]*\\bTarget="([^"]+)"`);
      const target = rels.match(relRegex);
      if (target) {
        const path = target[1].replace(/^\.?\//, '');
        return path.startsWith('xl/') ? path : `xl/${path}`;
      }
    }
  }

  // Fallback: lowest-numbered worksheet part.
  const worksheets = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/(\d+)\.xml$/)![1]);
      const rightNumber = Number(right.match(/(\d+)\.xml$/)![1]);
      return leftNumber - rightNumber;
    });

  return worksheets[0] || null;
}

function parseXlsx(buffer: Buffer) {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('The Excel file could not be read. Re-save it as .xlsx or export it as CSV.');
  }

  const worksheetPath = resolveFirstWorksheetPath(zip);
  if (!worksheetPath) {
    throw new Error('No worksheet was found in the Excel file.');
  }

  const worksheetXml = zip.getEntry(worksheetPath)?.getData().toString('utf8');
  if (!worksheetXml) {
    throw new Error('The first worksheet in the Excel file is empty or unreadable.');
  }

  const sharedStringsXml = zip.getEntry('xl/sharedStrings.xml')?.getData().toString('utf8');
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  return parseWorksheet(worksheetXml, sharedStrings);
}

/** Picks the delimiter that appears most often in the header line. */
function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) || '';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180-style parse: honours quoted fields, "" escapes and embedded newlines. */
function parseDelimited(text: string) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(normalized);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawContent = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawContent = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
      sawContent = true;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawContent = false;
    } else if (char !== '\r') {
      field += char;
      sawContent = true;
    }
  }

  if (sawContent || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses an uploaded roster into header-keyed rows. Blank rows are dropped and
 * every value is trimmed. Throws a user-facing Error when the file is
 * unreadable or has no header row.
 */
export function parseTabularUpload(buffer: Buffer, filename: string): ParsedSheet {
  const lowerName = (filename || '').toLowerCase();
  const isXlsx = XLSX_EXTENSIONS.some((extension) => lowerName.endsWith(extension));

  const matrix = isXlsx ? parseXlsx(buffer) : parseDelimited(buffer.toString('utf8'));
  const nonEmpty = matrix.filter((cells) => cells.some((cell) => (cell || '').trim().length > 0));

  if (nonEmpty.length === 0) {
    throw new Error('The uploaded file is empty.');
  }

  const headers = nonEmpty[0].map((cell) => (cell || '').trim());
  if (headers.every((header) => header.length === 0)) {
    throw new Error('The first row must contain column headings.');
  }

  const keys = headers.map(normalizeHeader);
  const rows = nonEmpty.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      if (!key) {
        return;
      }
      record[key] = (cells[index] || '').trim();
    });
    return record;
  });

  return { headers, rows };
}
