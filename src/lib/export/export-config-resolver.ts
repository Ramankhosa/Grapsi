import {
  EXPORT_PROFILE_FIELD_PATHS,
  getValueAtPath,
  hasPathValue,
  normalizeExportProfile,
  normalizeExportProfilePartial,
  SYSTEM_DEFAULTS,
  type ExportProfile,
  type PartialExportProfile,
} from '@/lib/export/export-profile-schema';

export type ExportConfigFieldSource = 'default' | 'llm' | 'override';

export interface ResolvedExportFieldSource {
  source: ExportConfigFieldSource;
  confidence: number | null;
}

export interface ResolvedExportConfigResult {
  config: ExportProfile;
  fieldSources: Record<string, ResolvedExportFieldSource>;
  llmProfile: PartialExportProfile | null;
  userOverrides: PartialExportProfile;
  venueDefaults: PartialExportProfile;
}

export function resolveExportConfig(
  llmProfile: PartialExportProfile | null,
  userOverrides: PartialExportProfile | null,
  venueDefaults: PartialExportProfile | null,
): ExportProfile {
  return normalizeExportProfile(userOverrides ?? {}, [
    venueDefaults ?? {},
    llmProfile ?? {},
  ]);
}

export function resolveExportConfigWithSources(
  llmProfile: PartialExportProfile | null,
  userOverrides: PartialExportProfile | null,
  venueDefaults: PartialExportProfile | null,
): ResolvedExportConfigResult {
  const normalizedLlm = llmProfile ? normalizeExportProfilePartial(llmProfile) : null;
  const normalizedOverrides = normalizeExportProfilePartial(userOverrides ?? {});
  const normalizedVenue = normalizeExportProfilePartial(venueDefaults ?? {});
  const config = resolveExportConfig(normalizedLlm, normalizedOverrides, normalizedVenue);

  const fieldSources = Object.fromEntries(
    EXPORT_PROFILE_FIELD_PATHS.map((path) => [
      path,
      resolveFieldSource(path, normalizedLlm, normalizedOverrides),
    ]),
  ) as Record<string, ResolvedExportFieldSource>;

  return {
    config,
    fieldSources,
    llmProfile: normalizedLlm,
    userOverrides: normalizedOverrides,
    venueDefaults: normalizedVenue,
  };
}

export function parseVenueExportProfile(venue: {
  formattingGuidelines?: unknown;
  citationStyle?: { code?: string | null } | null;
} | null | undefined): PartialExportProfile {
  const guidelines = isPlainObject(venue?.formattingGuidelines)
    ? (venue?.formattingGuidelines as Record<string, unknown>)
    : {};

  const citationStyleCode = cleanString(
    typeof guidelines.citationStyle === 'string'
      ? guidelines.citationStyle
      : venue?.citationStyle?.code,
  );

  const profile: PartialExportProfile = {
    documentClass: normalizeDocumentClassValue(
      cleanString(guidelines.documentClass) || cleanString(guidelines.template),
    ),
    documentClassOptions: parseStringArray(
      guidelines.documentClassOptions ?? guidelines.classOptions ?? guidelines.templateOptions,
    ),
    columnLayout: parseColumnLayout(guidelines.columnLayout ?? guidelines.columns),
    fontFamily: cleanString(guidelines.fontFamily) || cleanString(guidelines.font),
    fontSizePt: parseNumber(guidelines.fontSizePt ?? guidelines.fontSize),
    lineSpacing: parseNumber(guidelines.lineSpacing),
    pageSize: normalizePageSizeValue(cleanString(guidelines.pageSize)),
    margins: parseMargins(guidelines.margins),
    headerContent: cleanString(guidelines.headerContent ?? guidelines.header),
    footerContent: cleanString(guidelines.footerContent ?? guidelines.footer),
    includePageNumbers: parseBoolean(guidelines.includePageNumbers ?? guidelines.pageNumbers),
    pageNumberPosition: normalizePageNumberPositionValue(cleanString(guidelines.pageNumberPosition)),
    sectionNumbering: parseBoolean(guidelines.sectionNumbering),
    abstractStyle: normalizeAbstractStyleValue(cleanString(guidelines.abstractStyle)),
    bibliographyStyle: cleanString(guidelines.bibliographyStyle ?? guidelines.bibStyle),
    citationStyle: citationStyleCode || undefined,
    citationCommand: cleanString(guidelines.citationCommand),
    latexPackages: parseStringArray(guidelines.latexPackages),
    latexPreambleExtra: cleanString(guidelines.latexPreambleExtra),
  };

  return normalizeExportProfilePartial(profile);
}

export function summarizeDocxExportConfig(config: ExportProfile): string {
  const marginLabel = `${roundNumber(config.margins.topCm)} cm margins`;
  return [config.fontFamily, `${config.fontSizePt}pt`, config.pageSize, `${config.lineSpacing} spacing`, marginLabel]
    .filter(Boolean)
    .join(' | ');
}

export function summarizeLatexExportConfig(config: ExportProfile): string {
  const options = config.documentClassOptions?.join(', ') || (config.columnLayout === 2 ? 'twocolumn' : 'single-column');
  return [config.documentClass, options, `${config.bibliographyStyle} bib style`]
    .filter(Boolean)
    .join(' | ');
}

function resolveFieldSource(
  path: string,
  llmProfile: PartialExportProfile | null,
  userOverrides: PartialExportProfile,
): ResolvedExportFieldSource {
  if (hasMeaningfulPathValue(userOverrides, path)) {
    return { source: 'override', confidence: null };
  }

  if (llmProfile && hasMeaningfulPathValue(llmProfile, path)) {
    return {
      source: 'llm',
      confidence: lookupFieldConfidence(llmProfile, path),
    };
  }

  return { source: 'default', confidence: null };
}

function lookupFieldConfidence(llmProfile: PartialExportProfile, path: string): number | null {
  const fieldConfidences = llmProfile.fieldConfidences || {};
  const root = path.split('.')[0] || path;
  const direct = fieldConfidences[path];
  const rootValue = fieldConfidences[root];
  const value = typeof direct === 'number'
    ? direct
    : typeof rootValue === 'number'
    ? rootValue
    : null;

  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function hasMeaningfulPathValue(source: unknown, path: string): boolean {
  if (!hasPathValue(source, path)) return false;
  const value = getValueAtPath(source, path);
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function parseMargins(value: unknown): PartialExportProfile['margins'] | undefined {
  if (!value) return undefined;
  if (typeof value === 'string' || typeof value === 'number') {
    const amount = parseMeasurementToCm(value);
    if (amount === null) return undefined;
    return { topCm: amount, bottomCm: amount, leftCm: amount, rightCm: amount };
  }

  if (!isPlainObject(value)) return undefined;

  const top = parseMeasurementToCm(value.top ?? value.vertical ?? value.all);
  const bottom = parseMeasurementToCm(value.bottom ?? value.vertical ?? value.all);
  const left = parseMeasurementToCm(value.left ?? value.horizontal ?? value.all);
  const right = parseMeasurementToCm(value.right ?? value.horizontal ?? value.all);

  if ([top, bottom, left, right].every((entry) => entry === null)) {
    return undefined;
  }

  return {
    topCm: top ?? SYSTEM_DEFAULTS.margins.topCm,
    bottomCm: bottom ?? SYSTEM_DEFAULTS.margins.bottomCm,
    leftCm: left ?? SYSTEM_DEFAULTS.margins.leftCm,
    rightCm: right ?? SYSTEM_DEFAULTS.margins.rightCm,
  };
}

function parseMeasurementToCm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10 ? value / 10 : value;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([\d.]+)\s*(cm|mm|in|inch|inches)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = String(match[2] || 'cm').toLowerCase();
  if (unit === 'mm') return amount / 10;
  if (unit.startsWith('in')) return amount * 2.54;
  return amount;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return true;
    if (['false', 'no', '0', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function parseColumnLayout(value: unknown): 1 | 2 | undefined {
  const numeric = parseNumber(value);
  if (numeric === 2) return 2;
  if (numeric === 1) return 1;
  if (typeof value === 'string' && value.toLowerCase().includes('two')) return 2;
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => cleanString(entry)).filter(Boolean) as string[];
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

function normalizeDocumentClassValue(value: string | undefined): PartialExportProfile['documentClass'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (['article', 'report', 'book', 'IEEEtran', 'acmart', 'llncs', 'custom'].includes(normalized)) {
    return normalized as PartialExportProfile['documentClass'];
  }
  const lowered = normalized.toLowerCase();
  if (lowered === 'ieeetran') return 'IEEEtran';
  if (lowered === 'acmart') return 'acmart';
  if (lowered === 'llncs') return 'llncs';
  if (lowered === 'report') return 'report';
  if (lowered === 'book') return 'book';
  if (lowered === 'custom') return 'custom';
  return 'article';
}

function normalizePageSizeValue(value: string | undefined): PartialExportProfile['pageSize'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'LETTER' || normalized === 'A4' || normalized === 'A5') {
    return normalized as PartialExportProfile['pageSize'];
  }
  if (normalized === 'US LETTER' || normalized === 'LETTER PAPER') return 'LETTER';
  return undefined;
}

function normalizePageNumberPositionValue(value: string | undefined): PartialExportProfile['pageNumberPosition'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'top-right' || normalized === 'bottom-center' || normalized === 'bottom-right') {
    return normalized as PartialExportProfile['pageNumberPosition'];
  }
  if (normalized.includes('top') && normalized.includes('right')) return 'top-right';
  if (normalized.includes('bottom') && normalized.includes('right')) return 'bottom-right';
  if (normalized.includes('bottom')) return 'bottom-center';
  return undefined;
}

function normalizeAbstractStyleValue(value: string | undefined): PartialExportProfile['abstractStyle'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'block' || normalized === 'structured') {
    return normalized as PartialExportProfile['abstractStyle'];
  }
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roundNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
