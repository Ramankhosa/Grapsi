import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import prisma from '../prisma';
import type {
  ResearchAreaTaxonomyAreaRecord,
  ResearchAreaTaxonomyGroup,
  ResearchAreaTaxonomyPayload,
  ResearchAreaTaxonomyUploadSummary,
} from '../researcherProfile/types';
import { normalizeWhitespace } from '../recommendations/utils';

const REQUIRED_HEADERS = ['level1_code', 'level1_name', 'level2_code', 'level2_name'];
const DEFAULT_SOURCE_NAME = 'OECD FORD';
const MAX_TAXONOMY_ROWS = 5000;

type TaxonomyUploadRow = {
  id: string;
  source_name: string;
  original_filename: string | null;
  row_count: number;
  active_row_count: number;
  status: string;
  created_at: Date;
  activated_at: Date | null;
  archived_at: Date | null;
};

type TaxonomyAreaRow = {
  id: string;
  upload_id: string;
  level1_code: string;
  level1_name: string;
  level2_code: string;
  level2_name: string;
  description: string | null;
  aliases: string[];
  sort_order: number | null;
  is_active: boolean;
};

export interface ParsedResearchAreaTaxonomyRow {
  rowNumber: number;
  level1Code: string;
  level1Name: string;
  level2Code: string;
  level2Name: string;
  description: string;
  aliases: string[];
  sortOrder: number | null;
  isActive: boolean;
}

export interface ResearchAreaTaxonomyCsvParseResult {
  rows: ParsedResearchAreaTaxonomyRow[];
  warnings: string[];
}

export interface ResearchAreaTaxonomyUploadResult extends ResearchAreaTaxonomyPayload {
  uploaded: ResearchAreaTaxonomyUploadSummary;
  warnings: string[];
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function serializeUpload(row: TaxonomyUploadRow): ResearchAreaTaxonomyUploadSummary {
  return {
    id: row.id,
    sourceName: row.source_name,
    originalFilename: row.original_filename,
    rowCount: Number(row.row_count || 0),
    activeRowCount: Number(row.active_row_count || 0),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    activatedAt: row.activated_at ? row.activated_at.toISOString() : null,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  };
}

function serializeArea(row: TaxonomyAreaRow): ResearchAreaTaxonomyAreaRecord {
  return {
    id: row.id,
    uploadId: row.upload_id,
    level1Code: row.level1_code,
    level1Name: row.level1_name,
    level2Code: row.level2_code || '',
    level2Name: row.level2_name || '',
    description: row.description || '',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : null,
    isActive: Boolean(row.is_active),
  };
}

export function groupResearchAreaTaxonomyAreas(areas: ResearchAreaTaxonomyAreaRecord[]): ResearchAreaTaxonomyGroup[] {
  const groups = new Map<string, ResearchAreaTaxonomyGroup>();

  for (const area of areas) {
    const key = `${area.level1Code}::${area.level1Name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.areas.push(area);
    } else {
      groups.set(key, {
        level1Code: area.level1Code,
        level1Name: area.level1Name,
        areas: [area],
      });
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    areas: group.areas.sort(compareTaxonomyAreas),
  }));
}

function compareTaxonomyAreas(a: ResearchAreaTaxonomyAreaRecord, b: ResearchAreaTaxonomyAreaRecord) {
  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const level1 = a.level1Name.localeCompare(b.level1Name);
  if (level1 !== 0) return level1;
  return (a.level2Name || a.level2Code).localeCompare(b.level2Name || b.level2Code);
}

function normalizeHeader(value: string) {
  return normalizeWhitespace(value)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function parseCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field');
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function parseAliases(value: string) {
  return Array.from(
    new Set(
      normalizeWhitespace(value)
        .split(/[|;,]+/)
        .map((alias) => normalizeWhitespace(alias))
        .filter(Boolean)
    )
  );
}

function parseOptionalInteger(value: string, rowNumber: number) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: sort_order must be an integer`);
  }
  return parsed;
}

function parseActive(value: string, rowNumber: number) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;
  if (['1', 'true', 't', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'inactive'].includes(normalized)) return false;
  throw new Error(`Row ${rowNumber}: is_active must be true/false, yes/no, active/inactive, or 1/0`);
}

export function parseResearchAreaTaxonomyCsv(csvText: string): ResearchAreaTaxonomyCsvParseResult {
  const rows = parseCsvMatrix(csvText);
  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  const headers = rows[0].map(normalizeHeader);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingHeaders.join(', ')}`);
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const valueAt = (row: string[], header: string) => row[headerIndex.get(header) ?? -1] || '';
  const parsedRows: ParsedResearchAreaTaxonomyRow[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;
    const level1Code = normalizeWhitespace(valueAt(row, 'level1_code'));
    const level1Name = normalizeWhitespace(valueAt(row, 'level1_name'));
    const level2Code = normalizeWhitespace(valueAt(row, 'level2_code'));
    const level2Name = normalizeWhitespace(valueAt(row, 'level2_name'));

    if (!level1Code || !level1Name) {
      throw new Error(`Row ${rowNumber}: level1_code and level1_name are required`);
    }

    if ((level2Code && !level2Name) || (!level2Code && level2Name)) {
      throw new Error(`Row ${rowNumber}: level2_code and level2_name must both be present or both be blank`);
    }

    const key = `${level1Code.toLowerCase()}::${level2Code.toLowerCase()}`;
    if (seenKeys.has(key)) {
      throw new Error(`Row ${rowNumber}: duplicate level code pair ${level1Code}${level2Code ? ` / ${level2Code}` : ''}`);
    }
    seenKeys.add(key);

    parsedRows.push({
      rowNumber,
      level1Code,
      level1Name,
      level2Code,
      level2Name,
      description: normalizeWhitespace(valueAt(row, 'description')),
      aliases: parseAliases(valueAt(row, 'aliases')),
      sortOrder: parseOptionalInteger(valueAt(row, 'sort_order'), rowNumber),
      isActive: parseActive(valueAt(row, 'is_active'), rowNumber),
    });
  }

  if (parsedRows.length === 0) {
    throw new Error('CSV has headers but no taxonomy rows');
  }

  if (parsedRows.length > MAX_TAXONOMY_ROWS) {
    throw new Error(`CSV has ${parsedRows.length} rows; maximum supported taxonomy rows is ${MAX_TAXONOMY_ROWS}`);
  }

  const inactiveCount = parsedRows.filter((row) => !row.isActive).length;
  if (inactiveCount > 0) {
    warnings.push(`${inactiveCount} inactive taxonomy row${inactiveCount === 1 ? '' : 's'} imported for audit but hidden from researcher selection.`);
  }

  return { rows: parsedRows, warnings };
}

export class ResearchAreaTaxonomyService {
  async listActiveTaxonomy(options?: { includeInactive?: boolean }): Promise<ResearchAreaTaxonomyPayload> {
    const uploadRows = await prisma.$queryRaw<TaxonomyUploadRow[]>(Prisma.sql`
      SELECT id, source_name, original_filename, row_count, active_row_count, status, created_at, activated_at, archived_at
      FROM research_area_taxonomy_uploads
      WHERE status = 'ACTIVE'
      ORDER BY activated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `);
    const upload = uploadRows[0] ? serializeUpload(uploadRows[0]) : null;
    if (!upload) {
      return { upload: null, areas: [], groups: [], hasActiveTaxonomy: false };
    }

    const areaRows = options?.includeInactive
      ? await prisma.$queryRaw<TaxonomyAreaRow[]>(Prisma.sql`
          SELECT id, upload_id, level1_code, level1_name, level2_code, level2_name, description, aliases, sort_order, is_active
          FROM research_area_taxonomy_areas
          WHERE upload_id = ${upload.id}
          ORDER BY sort_order ASC NULLS LAST, level1_name ASC, level2_name ASC, level2_code ASC
        `)
      : await prisma.$queryRaw<TaxonomyAreaRow[]>(Prisma.sql`
          SELECT id, upload_id, level1_code, level1_name, level2_code, level2_name, description, aliases, sort_order, is_active
          FROM research_area_taxonomy_areas
          WHERE upload_id = ${upload.id}
            AND is_active = true
          ORDER BY sort_order ASC NULLS LAST, level1_name ASC, level2_name ASC, level2_code ASC
        `);
    const areas = areaRows.map(serializeArea);

    return {
      upload,
      areas,
      groups: groupResearchAreaTaxonomyAreas(areas),
      hasActiveTaxonomy: areas.some((area) => area.isActive),
    };
  }

  async getActiveAreaById(areaId: string): Promise<ResearchAreaTaxonomyAreaRecord | null> {
    const rows = await prisma.$queryRaw<TaxonomyAreaRow[]>(Prisma.sql`
      SELECT area.id, area.upload_id, area.level1_code, area.level1_name, area.level2_code, area.level2_name,
             area.description, area.aliases, area.sort_order, area.is_active
      FROM research_area_taxonomy_areas area
      INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
      WHERE area.id = ${areaId}
        AND area.is_active = true
        AND upload.status = 'ACTIVE'
      LIMIT 1
    `);

    return rows[0] ? serializeArea(rows[0]) : null;
  }

  async hasActiveTaxonomy(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM research_area_taxonomy_areas area
      INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
      WHERE area.is_active = true
        AND upload.status = 'ACTIVE'
    `);

    return Number(rows[0]?.count || 0) > 0;
  }

  async uploadTaxonomyCsv(input: {
    csvText: string;
    originalFilename?: string | null;
    sourceName?: string | null;
    uploadedBy: string;
  }): Promise<ResearchAreaTaxonomyUploadResult> {
    const parsed = parseResearchAreaTaxonomyCsv(input.csvText);
    const activeRows = parsed.rows.filter((row) => row.isActive);
    if (activeRows.length === 0) {
      throw new Error('CSV contains no active taxonomy rows');
    }

    const uploadId = createId('rat_upload');
    const now = new Date();
    const sourceName = normalizeWhitespace(input.sourceName || '') || DEFAULT_SOURCE_NAME;
    const originalFilename = normalizeWhitespace(input.originalFilename || '') || null;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE research_area_taxonomy_uploads
        SET status = 'ARCHIVED',
            archived_at = ${now}
        WHERE status = 'ACTIVE'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO research_area_taxonomy_uploads (
          id, source_name, original_filename, row_count, active_row_count, status, uploaded_by, created_at, activated_at
        )
        VALUES (${uploadId}, ${sourceName}, ${originalFilename}, ${parsed.rows.length}, ${activeRows.length}, 'ACTIVE', ${input.uploadedBy}, ${now}, ${now})
      `);

      for (const row of parsed.rows) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO research_area_taxonomy_areas (
            id, upload_id, level1_code, level1_name, level2_code, level2_name, description, aliases, sort_order, is_active
          )
          VALUES (
            ${createId('rat_area')},
            ${uploadId},
            ${row.level1Code},
            ${row.level1Name},
            ${row.level2Code},
            ${row.level2Name},
            ${row.description || null},
            ${row.aliases},
            ${row.sortOrder},
            ${row.isActive}
          )
        `);
      }
    });

    const taxonomy = await this.listActiveTaxonomy({ includeInactive: true });
    if (!taxonomy.upload) {
      throw new Error('Taxonomy upload completed but active taxonomy could not be loaded');
    }

    return {
      ...taxonomy,
      uploaded: taxonomy.upload,
      warnings: parsed.warnings,
    };
  }
}

export const researchAreaTaxonomyService = new ResearchAreaTaxonomyService();
