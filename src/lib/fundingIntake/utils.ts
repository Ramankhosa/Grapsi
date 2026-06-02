import axios from 'axios';
import { convert } from 'html-to-text';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { URL } from 'url';
import {
  ARRAY_FIELD_KEYS,
  BOOLEAN_FIELD_KEYS,
  DATE_FIELD_KEYS,
  FUNDING_FIELD_DEFINITIONS,
  NUMERIC_FIELD_KEYS,
  type FundingFieldKey,
} from './constants';
import type {
  FundingDraftValues,
  FundingEvidenceAnchor,
  FundingExtractionFieldStatus,
  FundingExtractionPayload,
  FundingExtractionValidationIssue,
  FundingSourceSegment,
  StructuredFieldValue,
} from './types';
import { FETCH_TIMEOUT_MS, MAX_FETCH_BYTES } from './constants';
import {
  normalizeApplicationLanguageList,
  normalizeCareerStageList,
  normalizeCountryInput,
  normalizeFundingKindList,
  normalizeGeographyScopeList,
  normalizeInstitutionTypeList,
  normalizeRegionList,
} from '../recommendations/utils';

export function normalizeWhitespace(input: string): string {
  return input.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeMultilineText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashText(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  return url.toString();
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }

  return false;
}

export async function assertSafePublicHttpsUrl(input: string): Promise<URL> {
  const url = new URL(input);
  const isTestLocalUrl =
    process.env.NODE_ENV === 'test' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase());

  if (isTestLocalUrl) {
    return url;
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }

  const { address } = await dns.lookup(url.hostname);
  if (isPrivateIp(address)) {
    throw new Error('Private or local network URLs are not allowed');
  }

  return url;
}

export async function fetchReadableUrlContent(input: string): Promise<{
  rawText: string;
  normalizedText: string;
  fetchMetadata: Record<string, unknown>;
}> {
  const safeUrl = await assertSafePublicHttpsUrl(input);

  const response = await axios.get(safeUrl.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'text',
    maxContentLength: MAX_FETCH_BYTES,
    maxBodyLength: MAX_FETCH_BYTES,
    maxRedirects: 3,
    headers: {
      'User-Agent': 'GrantMentor Funding Intake/1.0',
      Accept: 'text/html, text/plain, application/xhtml+xml',
    },
  });

  const contentType = String(response.headers['content-type'] || '');
  const responseUrl = String(response.request?.res?.responseUrl || safeUrl.toString());
  const finalUrl = await assertSafePublicHttpsUrl(responseUrl);

  const sourceText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const rawText = contentType.includes('html')
    ? convert(sourceText, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
        ],
      })
    : sourceText;

  const normalizedText = normalizeMultilineText(rawText);

  return {
    rawText,
    normalizedText,
    fetchMetadata: {
      contentType,
      fetchedUrl: finalUrl.toString(),
      httpStatus: response.status,
      domain: finalUrl.hostname,
      contentLength: Buffer.byteLength(sourceText, 'utf8'),
    },
  };
}

export function createEmptyStructuredField<T>(value: T | null = null): StructuredFieldValue<T> {
  return {
    value,
    status: value === null ? 'unsupported' : 'supported',
    confidence: 0,
    evidence: [],
  };
}

const INVALID_TEXT_VALUES = new Set(['[object Object]', 'null', 'undefined', 'nan']);
const OBJECT_VALUE_PRIORITY_KEYS = [
  'value',
  'label',
  'name',
  'title',
  'text',
  'summary',
  'description',
  'country',
  'region',
  'type',
  'kind',
  'url',
  'href',
  'email',
  'note',
] as const;
const OBJECT_VALUE_IGNORED_KEYS = new Set([
  'confidence',
  'evidence',
  'status',
  'id',
  'key',
  'code',
  'sourceType',
  'segmentId',
  'heading',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
]);

function sanitizeTextValue(value: string): string | null {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return null;
  }

  if (INVALID_TEXT_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueAnchors(values: FundingEvidenceAnchor[]): FundingEvidenceAnchor[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.sourceType}:${value.segmentId}:${normalizeWhitespace(value.quote).toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectStringCandidates(value: unknown, depth = 0, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined || depth > 4 || seen.has(value)) {
    return [];
  }

  if (typeof value === 'string') {
    const sanitized = sanitizeTextValue(value);
    return sanitized ? [sanitized] : [];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return uniqueStrings(value.flatMap((item) => collectStringCandidates(item, depth + 1, seen)));
  }

  if (typeof value !== 'object') {
    return [];
  }

  seen.add(value);
  const record = value as Record<string, unknown>;
  const prioritized = OBJECT_VALUE_PRIORITY_KEYS.flatMap((key) =>
    collectStringCandidates(record[key], depth + 1, seen)
  );

  if (prioritized.length > 0) {
    return uniqueStrings(prioritized);
  }

  return uniqueStrings(
    Object.entries(record)
      .filter(([key]) => !OBJECT_VALUE_IGNORED_KEYS.has(key))
      .flatMap(([, nestedValue]) => collectStringCandidates(nestedValue, depth + 1, seen))
  );
}

function coerceStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return uniqueStrings(
      value
        .split(/[\n,;]+/)
        .map((item) => sanitizeTextValue(item))
        .filter((item): item is string => Boolean(item))
    );
  }

  return uniqueStrings(collectStringCandidates(value));
}

function coerceText(value: unknown): string {
  return collectStringCandidates(value)[0] || '';
}

function coerceTextareaText(value: unknown): string {
  return collectStringCandidates(value).join('\n');
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return ['true', 'yes', '1', 'rolling', 'open'].includes(value.trim().toLowerCase());
  }

  return false;
}

function coerceDateString(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isMissingValue(value: unknown) {
  return value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function coerceFieldStatus(rawStatus: unknown, value: unknown): FundingExtractionFieldStatus {
  if (rawStatus === 'supported' || rawStatus === 'unsupported' || rawStatus === 'ambiguous') {
    return rawStatus;
  }

  return isMissingValue(value) ? 'unsupported' : 'supported';
}

function segmentIncludesQuote(segmentText: string, quote: string) {
  return normalizeWhitespace(segmentText).toLowerCase().includes(normalizeWhitespace(quote).toLowerCase());
}

function coerceEvidenceAnchors(
  value: unknown,
  segmentMap: Map<string, FundingSourceSegment>
): FundingEvidenceAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const anchors: FundingEvidenceAnchor[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const record = item as Record<string, unknown>;
    const segmentId = sanitizeTextValue(String(record.segmentId || '')) || null;
    const quote = sanitizeTextValue(coerceTextareaText(record.quote)) || null;
    if (!segmentId || !quote) {
      return;
    }

    const segment = segmentMap.get(segmentId);
    anchors.push({
      sourceType: 'segment',
      segmentId,
      quote,
      heading: sanitizeTextValue(coerceText(record.heading)) || segment?.heading || null,
    });
  });

  return uniqueAnchors(anchors);
}

export function normalizeFieldValue(key: FundingFieldKey, value: unknown): unknown {
  if (ARRAY_FIELD_KEYS.has(key)) {
    return coerceStringArray(value);
  }

  if (NUMERIC_FIELD_KEYS.has(key)) {
    return coerceNumber(value);
  }

  if (DATE_FIELD_KEYS.has(key)) {
    return coerceDateString(value);
  }

  if (BOOLEAN_FIELD_KEYS.has(key)) {
    return coerceBoolean(value);
  }

  if (value === null || value === undefined) {
    return '';
  }

  const fieldDefinition = FUNDING_FIELD_DEFINITIONS.find((definition) => definition.key === key);
  return fieldDefinition?.type === 'textarea' ? coerceTextareaText(value) : coerceText(value);
}

function normalizeCountryList(
  values: string[],
  fieldKey: FundingFieldKey
): { value: string[]; warnings: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];

  values.forEach((value) => {
    const normalized = normalizeCountryInput(value, { allowIsoCodes: true });
    if (normalized) {
      kept.push(normalized);
    } else if (sanitizeTextValue(value)) {
      dropped.push(value);
    }
  });

  return {
    value: uniqueStrings(kept),
    warnings: dropped.length > 0
      ? [`${fieldKey}: dropped unsupported values ${dropped.join(', ')}`]
      : [],
  };
}

function normalizeControlledFieldValue(
  key: FundingFieldKey,
  value: unknown
): { value: unknown; warnings: string[] } {
  if (key === 'eligible_countries' || key === 'host_countries') {
    return normalizeCountryList(coerceStringArray(value), key);
  }

  if (key === 'eligible_regions') {
    const normalized = normalizeRegionList(coerceStringArray(value));
    const warnings = normalized === null && coerceStringArray(value).length > 0
      ? [`${key}: dropped unsupported region values`]
      : [];
    return { value: normalized || [], warnings };
  }

  if (key === 'geography_scope') {
    const normalized = normalizeGeographyScopeList(coerceText(value) ? [coerceText(value)] : []);
    const nextValue = normalized && normalized.length > 0 ? normalized[0] : '';
    const warnings = !nextValue && coerceText(value)
      ? [`${key}: dropped unsupported geography scope value`]
      : [];
    return { value: nextValue, warnings };
  }

  if (key === 'funding_kinds') {
    const normalized = normalizeFundingKindList(coerceStringArray(value));
    return {
      value: normalized || [],
      warnings: normalized === null && coerceStringArray(value).length > 0
        ? [`${key}: dropped unsupported funding kind values`]
        : [],
    };
  }

  if (key === 'institution_types') {
    const normalized = normalizeInstitutionTypeList(coerceStringArray(value));
    return {
      value: normalized || [],
      warnings: normalized === null && coerceStringArray(value).length > 0
        ? [`${key}: dropped unsupported institution type values`]
        : [],
    };
  }

  if (key === 'career_stages') {
    const normalized = normalizeCareerStageList(coerceStringArray(value));
    return {
      value: normalized || [],
      warnings: normalized === null && coerceStringArray(value).length > 0
        ? [`${key}: dropped unsupported career stage values`]
        : [],
    };
  }

  if (key === 'application_languages') {
    const normalized = normalizeApplicationLanguageList(coerceStringArray(value));
    return {
      value: normalized || [],
      warnings: normalized === null && coerceStringArray(value).length > 0
        ? [`${key}: dropped unsupported application language values`]
        : [],
    };
  }

  return { value: normalizeFieldValue(key, value), warnings: [] };
}

export function buildFundingSourceSegments(sourceText: string): FundingSourceSegment[] {
  const normalized = normalizeMultilineText(sourceText);
  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => normalizeMultilineText(block))
    .filter(Boolean);

  let currentHeading: string | null = null;

  return blocks.map((text, index) => {
    const firstLine = text.split('\n')[0]?.trim() || '';
    const looksLikeHeading =
      firstLine.length > 0 &&
      firstLine.length <= 120 &&
      !/[.!?]$/.test(firstLine) &&
      !/\d{4}-\d{2}-\d{2}/.test(firstLine);

    if (looksLikeHeading) {
      currentHeading = firstLine;
    }

    return {
      id: `seg_${String(index + 1).padStart(3, '0')}`,
      text,
      heading: looksLikeHeading ? firstLine : currentHeading,
    };
  });
}

export function buildDescriptionFromEvidence(
  evidence: FundingEvidenceAnchor[],
  segmentMap: Map<string, FundingSourceSegment>
): { description: string; segmentIds: string[] } {
  const uniqueSegments: string[] = [];
  const chunks: string[] = [];

  evidence.forEach((anchor) => {
    if (!uniqueSegments.includes(anchor.segmentId)) {
      uniqueSegments.push(anchor.segmentId);
    }

    const segment = segmentMap.get(anchor.segmentId);
    const candidate = sanitizeTextValue(anchor.quote) || sanitizeTextValue(segment?.text || '');
    if (!candidate) {
      return;
    }

    if (!chunks.includes(candidate)) {
      chunks.push(candidate);
    }
  });

  const description = chunks
    .slice(0, 3)
    .reduce<string[]>((acc, chunk) => {
      const next = acc.concat(chunk);
      return next.join(' ').length <= 900 ? next : acc;
    }, [])
    .join('\n\n');

  return {
    description,
    segmentIds: uniqueSegments,
  };
}

export function normalizeExtractionPayload(
  raw: any,
  options?: { segments?: FundingSourceSegment[]; allowDescriptionWithoutEvidence?: boolean }
): FundingExtractionPayload {
  const fields = {} as FundingExtractionPayload['fields'];
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map((item: unknown) => String(item)) : [];
  const segments = options?.segments || [];
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));
  let summarySegments: string[] = [];

  for (const definition of FUNDING_FIELD_DEFINITIONS) {
    const rawField = raw?.fields?.[definition.key] || raw?.[definition.key] || {};
    const rawValue = rawField?.value ?? rawField ?? null;
    const normalized = normalizeControlledFieldValue(definition.key, rawValue);
    let value = normalized.value;
    const evidence = coerceEvidenceAnchors(rawField?.evidence, segmentMap);
    const confidence = Math.max(0, Math.min(1, Number(rawField?.confidence ?? 0)));
    let status = coerceFieldStatus(rawField?.status, value);

    warnings.push(...normalized.warnings);

    if (definition.key === 'description') {
      const deterministic = buildDescriptionFromEvidence(evidence, segmentMap);
      value = status === 'supported'
        ? deterministic.description || coerceTextareaText(value)
        : null;
      summarySegments = deterministic.segmentIds;
      status = deterministic.description || options?.allowDescriptionWithoutEvidence ? status : 'unsupported';
    }

    if (ARRAY_FIELD_KEYS.has(definition.key) && Array.isArray(value) && value.length === 0) {
      value = null;
    }

    if (status !== 'supported') {
      value = null;
    }

    if (isMissingValue(value)) {
      value = null;
      if (status === 'supported') {
        status = 'unsupported';
      }
    }

    fields[definition.key] = {
      value,
      status,
      confidence,
      evidence,
    };
  }

  return {
    fields,
    warnings: uniqueStrings(warnings.filter(Boolean)),
    summarySegments,
  };
}

export function buildDraftValuesFromExtraction(
  payload?: FundingExtractionPayload | null,
  options?: { sourceUrl?: string | null; fetchedUrl?: string | null }
): FundingDraftValues {
  const getField = (key: FundingFieldKey) => payload?.fields?.[key]?.value;

  const deterministicOfficialUrls = [options?.sourceUrl, options?.fetchedUrl]
    .map((value) => (typeof value === 'string' && value.trim() ? normalizeUrl(value) : null))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
  const extractedOfficialUrls = coerceStringArray(getField('official_urls'))
    .map((value) => {
      try {
        return normalizeUrl(value);
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));

  return {
    agency_name: coerceText(getField('agency_name')),
    scheme_title: coerceText(getField('scheme_title')),
    description: coerceTextareaText(getField('description')),
    open_date: coerceDateString(getField('open_date')),
    close_date: coerceDateString(getField('close_date')),
    is_rolling: coerceBoolean(getField('is_rolling')),
    geography_scope: coerceText(getField('geography_scope')),
    eligible_countries: coerceStringArray(getField('eligible_countries')),
    eligible_regions: coerceStringArray(getField('eligible_regions')),
    host_countries: coerceStringArray(getField('host_countries')),
    funder_country: coerceText(getField('funder_country')),
    funding_kinds: coerceStringArray(getField('funding_kinds')),
    institution_types: coerceStringArray(getField('institution_types')),
    career_stages: coerceStringArray(getField('career_stages')),
    citizenship_requirements: coerceStringArray(getField('citizenship_requirements')),
    residency_requirements: coerceStringArray(getField('residency_requirements')),
    application_languages: coerceStringArray(getField('application_languages')),
    disciplines: coerceStringArray(getField('disciplines')),
    amount_min: coerceNumber(getField('amount_min')),
    amount_max: coerceNumber(getField('amount_max')),
    currency: coerceText(getField('currency')),
    project_duration_min_months: coerceNumber(getField('project_duration_min_months')),
    project_duration_max_months: coerceNumber(getField('project_duration_max_months')),
    project_duration_text: coerceTextareaText(getField('project_duration_text')),
    eligibility_text: coerceTextareaText(getField('eligibility_text')),
    expected_deliverables_text: coerceTextareaText(getField('expected_deliverables_text')),
    official_urls: uniqueStrings([...deterministicOfficialUrls, ...extractedOfficialUrls]),
    contact_info: coerceTextareaText(getField('contact_info')),
    sponsor_type: coerceText(getField('sponsor_type')),
  };
}

export function extractConfidenceMap(payload: FundingExtractionPayload): Record<string, number> {
  return Object.fromEntries(
    Object.entries(payload.fields).map(([key, value]) => [key, value.confidence])
  );
}

export function extractEvidenceMap(
  payload: FundingExtractionPayload
): Record<string, FundingEvidenceAnchor[]> {
  return Object.fromEntries(
    Object.entries(payload.fields).map(([key, value]) => [key, value.evidence || []])
  );
}

export function extractMissingFieldKeys(payload: FundingExtractionPayload): string[] {
  return Object.entries(payload.fields)
    .filter(([, value]) => value.status === 'unsupported' || isMissingValue(value.value))
    .map(([key]) => key);
}

export function validateFundingExtractionPayload(
  payload: FundingExtractionPayload,
  segments: FundingSourceSegment[]
): FundingExtractionValidationIssue[] {
  const issues: FundingExtractionValidationIssue[] = [];
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));

  Object.entries(payload.fields).forEach(([fieldKey, fieldValue]) => {
    const hasValue = !isMissingValue(fieldValue.value);

    if (hasValue && fieldValue.evidence.length === 0) {
      issues.push({
        code: 'evidence_required',
        fieldKey,
        message: `${fieldKey} has a value but no evidence anchors`,
        retryable: true,
      });
    }

    if (fieldValue.status === 'unsupported' && hasValue) {
      issues.push({
        code: 'unsupported_field_has_value',
        fieldKey,
        message: `${fieldKey} is marked unsupported but still has a value`,
        retryable: true,
      });
    }

    if (fieldValue.status === 'supported' && !hasValue) {
      issues.push({
        code: 'supported_field_missing_value',
        fieldKey,
        message: `${fieldKey} is marked ${fieldValue.status} but has no normalized value`,
        retryable: true,
      });
    }

    if (fieldValue.status === 'ambiguous' && hasValue) {
      issues.push({
        code: 'ambiguous_field_has_value',
        fieldKey,
        message: `${fieldKey} is ambiguous and must not store a resolved value`,
        retryable: true,
      });
    }

    fieldValue.evidence.forEach((anchor) => {
      const segment = segmentMap.get(anchor.segmentId);
      if (!segment) {
        issues.push({
          code: 'invalid_segment_reference',
          fieldKey,
          message: `${fieldKey} references missing segment ${anchor.segmentId}`,
          retryable: true,
        });
        return;
      }

      if (!segmentIncludesQuote(segment.text, anchor.quote)) {
        issues.push({
          code: 'quote_not_in_segment',
          fieldKey,
          message: `${fieldKey} evidence quote does not match segment ${anchor.segmentId}`,
          retryable: false,
        });
      }
    });
  });

  const amountMin = payload.fields.amount_min?.value;
  const amountMax = payload.fields.amount_max?.value;
  const currency = payload.fields.currency?.value;

  if (typeof amountMin === 'number' && amountMin < 0) {
    issues.push({
      code: 'negative_amount_min',
      fieldKey: 'amount_min',
      message: 'amount_min cannot be negative',
    });
  }

  if (typeof amountMax === 'number' && amountMax < 0) {
    issues.push({
      code: 'negative_amount_max',
      fieldKey: 'amount_max',
      message: 'amount_max cannot be negative',
    });
  }

  if (
    typeof amountMin === 'number' &&
    typeof amountMax === 'number' &&
    amountMin > amountMax
  ) {
    issues.push({
      code: 'amount_range_invalid',
      fieldKey: 'amount_min',
      message: 'amount_min cannot be greater than amount_max',
    });
  }

  if (
    (typeof amountMin === 'number' || typeof amountMax === 'number') &&
    (!currency || typeof currency !== 'string' || currency.trim().length === 0)
  ) {
    issues.push({
      code: 'currency_required_when_amount_present',
      fieldKey: 'currency',
      message: 'currency is required when a funding amount is present',
    });
  }

  return issues;
}

export function normalizedTokenSet(input: string): Set<string> {
  return new Set(
    normalizeWhitespace(input)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const aSet = normalizedTokenSet(a);
  const bSet = normalizedTokenSet(b);

  if (!aSet.size || !bSet.size) {
    return 0;
  }

  let intersection = 0;
  Array.from(aSet).forEach((token) => {
    if (bSet.has(token)) {
      intersection += 1;
    }
  });

  const union = new Set(Array.from(aSet).concat(Array.from(bSet))).size;
  return union === 0 ? 0 : intersection / union;
}

export function normalizeDraftInput(input: Partial<FundingDraftValues>): FundingDraftValues {
  const payload = buildDraftValuesFromExtraction();

  for (const definition of FUNDING_FIELD_DEFINITIONS) {
    (payload as any)[definition.key] = normalizeFieldValue(definition.key, (input as any)?.[definition.key]);
  }

  return payload;
}

export function parseJsonResponse(rawText: string): any {
  const trimmed = rawText.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch?.[1] || trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  return JSON.parse(jsonText);
}
