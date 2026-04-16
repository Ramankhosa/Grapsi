import { z } from 'zod';

export const EXPORT_DOCUMENT_CLASSES = [
  'article',
  'report',
  'book',
  'IEEEtran',
  'acmart',
  'llncs',
  'custom',
] as const;

export const EXPORT_PAGE_SIZES = ['A4', 'LETTER', 'A5'] as const;
export const EXPORT_PAGE_NUMBER_POSITIONS = ['top-right', 'bottom-center', 'bottom-right'] as const;
export const EXPORT_ABSTRACT_STYLES = ['block', 'structured'] as const;

export type ExportDocumentClass = (typeof EXPORT_DOCUMENT_CLASSES)[number];
export type ExportPageSize = (typeof EXPORT_PAGE_SIZES)[number];
export type ExportPageNumberPosition = (typeof EXPORT_PAGE_NUMBER_POSITIONS)[number];
export type ExportAbstractStyle = (typeof EXPORT_ABSTRACT_STYLES)[number];

export interface ExportFont {
  name: string;
  category: 'serif' | 'sans-serif' | 'monospace';
  latexPackage: string | null;
  latexFontCmd: string | null;
}

export const EXPORT_FONT_REGISTRY: ExportFont[] = [
  { name: 'Times New Roman', category: 'serif', latexPackage: 'mathptmx', latexFontCmd: null },
  { name: 'Palatino', category: 'serif', latexPackage: 'mathpazo', latexFontCmd: null },
  { name: 'Georgia', category: 'serif', latexPackage: 'mathptmx', latexFontCmd: null },
  { name: 'Garamond', category: 'serif', latexPackage: 'ebgaramond', latexFontCmd: null },
  { name: 'Cambria', category: 'serif', latexPackage: 'mathptmx', latexFontCmd: null },
  { name: 'Book Antiqua', category: 'serif', latexPackage: 'mathpazo', latexFontCmd: null },
  { name: 'Computer Modern', category: 'serif', latexPackage: null, latexFontCmd: null },
  { name: 'Latin Modern', category: 'serif', latexPackage: 'lmodern', latexFontCmd: null },
  { name: 'Arial', category: 'sans-serif', latexPackage: 'helvet', latexFontCmd: '\\renewcommand{\\familydefault}{\\sfdefault}' },
  { name: 'Helvetica', category: 'sans-serif', latexPackage: 'helvet', latexFontCmd: '\\renewcommand{\\familydefault}{\\sfdefault}' },
  { name: 'Calibri', category: 'sans-serif', latexPackage: 'helvet', latexFontCmd: '\\renewcommand{\\familydefault}{\\sfdefault}' },
  { name: 'Verdana', category: 'sans-serif', latexPackage: 'helvet', latexFontCmd: '\\renewcommand{\\familydefault}{\\sfdefault}' },
  { name: 'Roboto', category: 'sans-serif', latexPackage: 'roboto', latexFontCmd: '\\renewcommand{\\familydefault}{\\sfdefault}' },
  { name: 'Courier New', category: 'monospace', latexPackage: 'courier', latexFontCmd: null },
  { name: 'Consolas', category: 'monospace', latexPackage: 'inconsolata', latexFontCmd: null },
];

export const EXPORT_CITATION_STYLE_ALIASES: Record<string, string> = {
  APA: 'APA7',
  APA7: 'APA7',
  IEEE: 'IEEE',
  HARVARD: 'HARVARD',
  MLA: 'MLA9',
  MLA9: 'MLA9',
  CHICAGO: 'CHICAGO',
  CHICAGO_AUTHOR_DATE: 'CHICAGO',
  VANCOUVER: 'VANCOUVER',
};

export const EXPORT_CITATION_COMMAND_OPTIONS = ['\\cite', '\\citep', '\\citet'] as const;

const ExportMarginsSchema = z.object({
  topCm: z.number(),
  bottomCm: z.number(),
  leftCm: z.number(),
  rightCm: z.number(),
});

export const ExportProfileSchema = z.object({
  documentClass: z.enum(EXPORT_DOCUMENT_CLASSES),
  documentClassOptions: z.array(z.string()).optional(),
  columnLayout: z.union([z.literal(1), z.literal(2)]),
  fontFamily: z.string().min(1),
  fontSizePt: z.number(),
  lineSpacing: z.number(),
  pageSize: z.enum(EXPORT_PAGE_SIZES),
  margins: ExportMarginsSchema,
  headerContent: z.string().optional(),
  footerContent: z.string().optional(),
  includePageNumbers: z.boolean(),
  pageNumberPosition: z.enum(EXPORT_PAGE_NUMBER_POSITIONS),
  sectionNumbering: z.boolean(),
  abstractStyle: z.enum(EXPORT_ABSTRACT_STYLES),
  bibliographyStyle: z.string().min(1),
  citationStyle: z.string().min(1),
  citationCommand: z.string().min(1),
  latexPackages: z.array(z.string()).optional(),
  latexPreambleExtra: z.string().optional(),
  extractionConfidence: z.number(),
  fieldConfidences: z.record(z.number()),
  sourceDescription: z.string().optional(),
});

export const ExportProfilePartialSchema = ExportProfileSchema.deepPartial();

export type ExportProfile = z.infer<typeof ExportProfileSchema>;
export type PartialExportProfile = z.infer<typeof ExportProfilePartialSchema>;

export const SYSTEM_DEFAULTS: ExportProfile = {
  documentClass: 'article',
  documentClassOptions: [],
  columnLayout: 1,
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 1.5,
  pageSize: 'A4',
  margins: {
    topCm: 2.54,
    bottomCm: 2.54,
    leftCm: 2.54,
    rightCm: 2.54,
  },
  includePageNumbers: true,
  pageNumberPosition: 'bottom-center',
  sectionNumbering: true,
  abstractStyle: 'block',
  bibliographyStyle: 'plain',
  citationStyle: 'APA7',
  citationCommand: '\\cite',
  extractionConfidence: 1,
  fieldConfidences: {},
};

export const EXPORT_PROFILE_FIELD_PATHS = [
  'documentClass',
  'documentClassOptions',
  'columnLayout',
  'fontFamily',
  'fontSizePt',
  'lineSpacing',
  'pageSize',
  'margins.topCm',
  'margins.bottomCm',
  'margins.leftCm',
  'margins.rightCm',
  'headerContent',
  'footerContent',
  'includePageNumbers',
  'pageNumberPosition',
  'sectionNumbering',
  'abstractStyle',
  'bibliographyStyle',
  'citationStyle',
  'citationCommand',
  'latexPackages',
  'latexPreambleExtra',
  'extractionConfidence',
  'sourceDescription',
] as const;

export function normalizeExportProfile(input: unknown, fallbacks: PartialExportProfile[] = []): ExportProfile {
  const normalizedFallbacks = fallbacks.map(fallback => normalizeExportProfilePartial(fallback));
  const normalizedInput = normalizeExportProfilePartial(input);
  const merged = deepMergeObjects<ExportProfile>(
    SYSTEM_DEFAULTS,
    ...normalizedFallbacks,
    normalizedInput
  );

  const fontResolution = resolveRegisteredFont(merged.fontFamily);
  const citationStyle = normalizeCitationStyleCode(merged.citationStyle);

  return {
    documentClass: normalizeDocumentClass(merged.documentClass),
    documentClassOptions: sanitizeStringArray(merged.documentClassOptions),
    columnLayout: merged.columnLayout === 2 ? 2 : 1,
    fontFamily: fontResolution.name,
    fontSizePt: clampNumber(merged.fontSizePt, 8, 24, SYSTEM_DEFAULTS.fontSizePt),
    lineSpacing: clampNumber(merged.lineSpacing, 0.5, 3, SYSTEM_DEFAULTS.lineSpacing),
    pageSize: normalizePageSize(merged.pageSize),
    margins: normalizeMargins(merged.margins),
    headerContent: cleanOptionalString(merged.headerContent),
    footerContent: cleanOptionalString(merged.footerContent),
    includePageNumbers: Boolean(merged.includePageNumbers),
    pageNumberPosition: normalizePageNumberPosition(merged.pageNumberPosition),
    sectionNumbering: merged.sectionNumbering !== false,
    abstractStyle: normalizeAbstractStyle(merged.abstractStyle),
    bibliographyStyle: normalizeBibliographyStyle(merged.bibliographyStyle, citationStyle),
    citationStyle,
    citationCommand: normalizeCitationCommand(merged.citationCommand, citationStyle),
    latexPackages: sanitizeLatexPackages(merged.latexPackages),
    latexPreambleExtra: sanitizeLatexPreambleExtra(merged.latexPreambleExtra),
    extractionConfidence: clampNumber(merged.extractionConfidence, 0, 1, SYSTEM_DEFAULTS.extractionConfidence),
    fieldConfidences: sanitizeFieldConfidences(merged.fieldConfidences),
    sourceDescription: cleanOptionalString(merged.sourceDescription),
  };
}

export function normalizeExportProfilePartial(input: unknown): PartialExportProfile {
  const parsed = ExportProfilePartialSchema.parse(input ?? {});
  const output: PartialExportProfile = {};

  if (parsed.documentClass) output.documentClass = normalizeDocumentClass(parsed.documentClass);
  if (parsed.documentClassOptions) output.documentClassOptions = sanitizeStringArray(parsed.documentClassOptions);
  if (parsed.columnLayout) output.columnLayout = parsed.columnLayout === 2 ? 2 : 1;
  if (typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()) {
    output.fontFamily = resolveRegisteredFont(parsed.fontFamily).name;
  }
  if (typeof parsed.fontSizePt === 'number') output.fontSizePt = clampNumber(parsed.fontSizePt, 8, 24, SYSTEM_DEFAULTS.fontSizePt);
  if (typeof parsed.lineSpacing === 'number') output.lineSpacing = clampNumber(parsed.lineSpacing, 0.5, 3, SYSTEM_DEFAULTS.lineSpacing);
  if (parsed.pageSize) output.pageSize = normalizePageSize(parsed.pageSize);
  if (parsed.margins) {
    const margins: Partial<ExportProfile['margins']> = {};
    if (typeof parsed.margins.topCm === 'number') margins.topCm = clampNumber(parsed.margins.topCm, 0.5, 5, SYSTEM_DEFAULTS.margins.topCm);
    if (typeof parsed.margins.bottomCm === 'number') margins.bottomCm = clampNumber(parsed.margins.bottomCm, 0.5, 5, SYSTEM_DEFAULTS.margins.bottomCm);
    if (typeof parsed.margins.leftCm === 'number') margins.leftCm = clampNumber(parsed.margins.leftCm, 0.5, 5, SYSTEM_DEFAULTS.margins.leftCm);
    if (typeof parsed.margins.rightCm === 'number') margins.rightCm = clampNumber(parsed.margins.rightCm, 0.5, 5, SYSTEM_DEFAULTS.margins.rightCm);
    if (Object.keys(margins).length > 0) output.margins = margins as ExportProfile['margins'];
  }
  if (typeof parsed.headerContent === 'string') output.headerContent = cleanOptionalString(parsed.headerContent);
  if (typeof parsed.footerContent === 'string') output.footerContent = cleanOptionalString(parsed.footerContent);
  if (typeof parsed.includePageNumbers === 'boolean') output.includePageNumbers = parsed.includePageNumbers;
  if (parsed.pageNumberPosition) output.pageNumberPosition = normalizePageNumberPosition(parsed.pageNumberPosition);
  if (typeof parsed.sectionNumbering === 'boolean') output.sectionNumbering = parsed.sectionNumbering;
  if (parsed.abstractStyle) output.abstractStyle = normalizeAbstractStyle(parsed.abstractStyle);
  if (typeof parsed.bibliographyStyle === 'string' && parsed.bibliographyStyle.trim()) {
    output.bibliographyStyle = parsed.bibliographyStyle.trim();
  }
  if (typeof parsed.citationStyle === 'string' && parsed.citationStyle.trim()) {
    output.citationStyle = normalizeCitationStyleCode(parsed.citationStyle);
  }
  if (typeof parsed.citationCommand === 'string' && parsed.citationCommand.trim()) {
    output.citationCommand = parsed.citationCommand.trim();
  }
  if (parsed.latexPackages) output.latexPackages = sanitizeLatexPackages(parsed.latexPackages);
  if (typeof parsed.latexPreambleExtra === 'string') {
    output.latexPreambleExtra = sanitizeLatexPreambleExtra(parsed.latexPreambleExtra);
  }
  if (typeof parsed.extractionConfidence === 'number') {
    output.extractionConfidence = clampNumber(parsed.extractionConfidence, 0, 1, 0);
  }
  if (parsed.fieldConfidences) output.fieldConfidences = sanitizeFieldConfidences(parsed.fieldConfidences);
  if (typeof parsed.sourceDescription === 'string') {
    output.sourceDescription = cleanOptionalString(parsed.sourceDescription);
  }

  if (output.fontFamily && (!output.fieldConfidences || output.fieldConfidences.fontFamily === undefined)) {
    const originalFont = typeof parsed.fontFamily === 'string' ? parsed.fontFamily.trim() : '';
    if (originalFont && !findRegisteredFont(originalFont)) {
      output.fieldConfidences = {
        ...(output.fieldConfidences || {}),
        fontFamily: 0.3,
      };
    }
  }

  const normalizedCitationStyle = output.citationStyle;
  if (normalizedCitationStyle) {
    output.bibliographyStyle = normalizeBibliographyStyle(
      output.bibliographyStyle,
      normalizedCitationStyle
    );
    output.citationCommand = normalizeCitationCommand(
      output.citationCommand,
      normalizedCitationStyle
    );
  }

  return pruneEmptyObject(output) as PartialExportProfile;
}

export function buildExportProfileJsonSchemaText(): string {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'documentClass',
      'columnLayout',
      'fontFamily',
      'fontSizePt',
      'lineSpacing',
      'pageSize',
      'margins',
      'includePageNumbers',
      'pageNumberPosition',
      'sectionNumbering',
      'abstractStyle',
      'bibliographyStyle',
      'citationStyle',
      'citationCommand',
      'extractionConfidence',
      'fieldConfidences',
    ],
    properties: {
      documentClass: { type: ['string', 'null'], enum: [...EXPORT_DOCUMENT_CLASSES, null] },
      documentClassOptions: { type: ['array', 'null'], items: { type: 'string' } },
      columnLayout: { type: ['integer', 'null'], enum: [1, 2, null] },
      fontFamily: { type: ['string', 'null'] },
      fontSizePt: { type: ['number', 'null'] },
      lineSpacing: { type: ['number', 'null'] },
      pageSize: { type: ['string', 'null'], enum: [...EXPORT_PAGE_SIZES, null] },
      margins: {
        type: ['object', 'null'],
        properties: {
          topCm: { type: ['number', 'null'] },
          bottomCm: { type: ['number', 'null'] },
          leftCm: { type: ['number', 'null'] },
          rightCm: { type: ['number', 'null'] },
        },
      },
      headerContent: { type: ['string', 'null'] },
      footerContent: { type: ['string', 'null'] },
      includePageNumbers: { type: ['boolean', 'null'] },
      pageNumberPosition: { type: ['string', 'null'], enum: [...EXPORT_PAGE_NUMBER_POSITIONS, null] },
      sectionNumbering: { type: ['boolean', 'null'] },
      abstractStyle: { type: ['string', 'null'], enum: [...EXPORT_ABSTRACT_STYLES, null] },
      bibliographyStyle: { type: ['string', 'null'] },
      citationStyle: { type: ['string', 'null'] },
      citationCommand: { type: ['string', 'null'] },
      latexPackages: { type: ['array', 'null'], items: { type: 'string' } },
      latexPreambleExtra: { type: ['string', 'null'] },
      extractionConfidence: { type: 'number' },
      fieldConfidences: { type: 'object', additionalProperties: { type: 'number' } },
      sourceDescription: { type: ['string', 'null'] },
    },
  };

  return JSON.stringify(schema, null, 2);
}

export function getLatexFontSetup(fontFamily: string): { packageName: string | null; fontCommand: string | null } {
  const font = resolveRegisteredFont(fontFamily);
  return {
    packageName: font.latexPackage,
    fontCommand: font.latexFontCmd,
  };
}

export function normalizeCitationStyleCode(value: string): string {
  const normalized = String(value || '').trim().toUpperCase();
  return EXPORT_CITATION_STYLE_ALIASES[normalized] || normalized || SYSTEM_DEFAULTS.citationStyle;
}

export function resolveRegisteredFont(fontFamily: string): ExportFont {
  const direct = findRegisteredFont(fontFamily);
  if (direct) return direct;

  const category = inferFontCategory(fontFamily);
  return EXPORT_FONT_REGISTRY.find(font => font.category === category)
    || EXPORT_FONT_REGISTRY[0];
}

export function findRegisteredFont(fontFamily: string): ExportFont | null {
  const normalized = String(fontFamily || '').trim().toLowerCase();
  if (!normalized) return null;
  return EXPORT_FONT_REGISTRY.find(font => font.name.toLowerCase() === normalized) || null;
}

export function getValueAtPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object' || !path) return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

export function hasPathValue(source: unknown, path: string): boolean {
  const value = getValueAtPath(source, path);
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function setValueAtPath<T extends Record<string, unknown>>(source: T, path: string, value: unknown): T {
  const segments = path.split('.');
  const clone: Record<string, unknown> = { ...source };
  let cursor: Record<string, unknown> = clone;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    const next = cursor[segment];
    const safeNext = next && typeof next === 'object' && !Array.isArray(next)
      ? { ...(next as Record<string, unknown>) }
      : {};
    cursor[segment] = safeNext;
    cursor = safeNext;
  });

  return clone as T;
}

export function removeValueAtPath<T extends Record<string, unknown>>(source: T, path: string): T {
  const segments = path.split('.');
  const clone: Record<string, unknown> = { ...source };
  let cursor: Record<string, unknown> = clone;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return clone as T;
    }
    cursor[segment] = { ...(next as Record<string, unknown>) };
    cursor = cursor[segment] as Record<string, unknown>;
  }

  delete cursor[segments[segments.length - 1]];
  return pruneEmptyObject(clone) as T;
}

function normalizeDocumentClass(value: unknown): ExportDocumentClass {
  const raw = String(value || '').trim();
  if (!raw) return SYSTEM_DEFAULTS.documentClass;
  const lower = raw.toLowerCase();
  if (lower === 'article') return 'article';
  if (lower === 'report') return 'report';
  if (lower === 'book') return 'book';
  if (lower === 'ieeetran') return 'IEEEtran';
  if (lower === 'acmart') return 'acmart';
  if (lower === 'llncs') return 'llncs';
  return 'custom';
}

function normalizePageSize(value: unknown): ExportPageSize {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'LETTER') return 'LETTER';
  if (raw === 'A5') return 'A5';
  return 'A4';
}

function normalizePageNumberPosition(value: unknown): ExportPageNumberPosition {
  const raw = String(value || '').trim();
  if (raw === 'top-right' || raw === 'bottom-right' || raw === 'bottom-center') return raw;
  return SYSTEM_DEFAULTS.pageNumberPosition;
}

function normalizeAbstractStyle(value: unknown): ExportAbstractStyle {
  return value === 'structured' ? 'structured' : 'block';
}

function normalizeMargins(value: Partial<ExportProfile['margins']> | undefined): ExportProfile['margins'] {
  return {
    topCm: clampNumber(value?.topCm, 0.5, 5, SYSTEM_DEFAULTS.margins.topCm),
    bottomCm: clampNumber(value?.bottomCm, 0.5, 5, SYSTEM_DEFAULTS.margins.bottomCm),
    leftCm: clampNumber(value?.leftCm, 0.5, 5, SYSTEM_DEFAULTS.margins.leftCm),
    rightCm: clampNumber(value?.rightCm, 0.5, 5, SYSTEM_DEFAULTS.margins.rightCm),
  };
}

function normalizeBibliographyStyle(style: unknown, citationStyle: string): string {
  const raw = String(style || '').trim();
  if (raw) return raw;

  const normalizedCitationStyle = normalizeCitationStyleCode(citationStyle);
  if (normalizedCitationStyle === 'IEEE' || normalizedCitationStyle === 'VANCOUVER') return 'IEEEtran';
  if (normalizedCitationStyle === 'APA7') return 'apalike';
  if (normalizedCitationStyle === 'CHICAGO') return 'chicago';
  return SYSTEM_DEFAULTS.bibliographyStyle;
}

function normalizeCitationCommand(command: unknown, citationStyle: string): string {
  const raw = String(command || '').trim();
  if (EXPORT_CITATION_COMMAND_OPTIONS.includes(raw as (typeof EXPORT_CITATION_COMMAND_OPTIONS)[number])) {
    return raw;
  }

  const normalizedCitationStyle = normalizeCitationStyleCode(citationStyle);
  if (normalizedCitationStyle === 'IEEE' || normalizedCitationStyle === 'VANCOUVER') return '\\cite';
  return '\\citep';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  ));
}

function sanitizeLatexPackages(value: unknown): string[] {
  return sanitizeStringArray(value).filter(entry => /^[A-Za-z0-9_.-]+$/.test(entry));
}

function sanitizeLatexPreambleExtra(value: unknown): string | undefined {
  const raw = cleanOptionalString(value);
  if (!raw) return undefined;

  const safeLines = raw
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => !/\\(?:input|include|write18|openout|read|write)\b/i.test(line));

  const sanitized = safeLines.join('\n').trim();
  if (!sanitized) return undefined;
  return hasBalancedLatexBraces(sanitized) ? sanitized : undefined;
}

function sanitizeFieldConfidences(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => Boolean(String(key || '').trim()))
      .map(([key, confidence]) => [
        key,
        clampNumber(Number(confidence), 0, 1, 0),
      ])
  );
}

function inferFontCategory(fontFamily: string): ExportFont['category'] {
  const raw = String(fontFamily || '').trim().toLowerCase();
  if (!raw) return 'serif';
  if (/(courier|console|mono|code|consolas|inconsolata)/.test(raw)) return 'monospace';
  if (/(arial|helvetica|calibri|verdana|roboto|sans)/.test(raw)) return 'sans-serif';
  return 'serif';
}

function cleanOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function hasBalancedLatexBraces(value: string): boolean {
  let count = 0;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const previous = index > 0 ? value[index - 1] : '';

    if (current === '{' && previous !== '\\') count += 1;
    if (current === '}' && previous !== '\\') count -= 1;
    if (count < 0) return false;
  }

  return count === 0;
}

function pruneEmptyObject<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;

    if (Array.isArray(entry)) {
      if (entry.length > 0) clone[key] = entry;
      continue;
    }

    if (typeof entry === 'object') {
      const pruned = pruneEmptyObject(entry);
      if (pruned && typeof pruned === 'object' && Object.keys(pruned as Record<string, unknown>).length > 0) {
        clone[key] = pruned;
      }
      continue;
    }

    clone[key] = entry;
  }

  return clone as T;
}

function deepMergeObjects<T extends Record<string, unknown>>(...records: unknown[]): T {
  const output: Record<string, unknown> = {};

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    mergeInto(output, record as Record<string, unknown>);
  }

  return output as T;
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = target[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        mergeInto(current as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = deepMergeObjects(value);
      }
      continue;
    }

    target[key] = value;
  }
}
