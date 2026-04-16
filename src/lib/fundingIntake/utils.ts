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
import type { FundingDraftValues, FundingExtractionPayload, StructuredFieldValue } from './types';
import { FETCH_TIMEOUT_MS, MAX_FETCH_BYTES } from './constants';

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
    confidence: 0,
    evidence: null,
    is_missing: value === null || value === '' || (Array.isArray(value) && value.length === 0),
    is_uncertain: true,
  };
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
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

  return String(value).trim();
}

export function normalizeExtractionPayload(raw: any): FundingExtractionPayload {
  const fields = {} as FundingExtractionPayload['fields'];

  for (const definition of FUNDING_FIELD_DEFINITIONS) {
    const rawField = raw?.fields?.[definition.key] || raw?.[definition.key] || {};
    const rawValue = rawField?.value ?? rawField ?? null;
    const value = normalizeFieldValue(definition.key, rawValue);
    fields[definition.key] = {
      value,
      confidence: Math.max(0, Math.min(1, Number(rawField?.confidence ?? 0))),
      evidence: rawField?.evidence ? String(rawField.evidence).trim() : null,
      is_missing: Boolean(rawField?.is_missing) || value === null || value === '' || (Array.isArray(value) && value.length === 0),
      is_uncertain: rawField?.is_uncertain === undefined ? true : Boolean(rawField.is_uncertain),
    };
  }

  return {
    fields,
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map((item: unknown) => String(item)) : [],
  };
}

export function buildDraftValuesFromExtraction(payload?: FundingExtractionPayload | null): FundingDraftValues {
  const getField = (key: FundingFieldKey) => payload?.fields?.[key]?.value;

  return {
    agency_name: String(getField('agency_name') || ''),
    scheme_title: String(getField('scheme_title') || ''),
    description: String(getField('description') || ''),
    open_date: coerceDateString(getField('open_date')),
    close_date: coerceDateString(getField('close_date')),
    is_rolling: coerceBoolean(getField('is_rolling')),
    geography_scope: String(getField('geography_scope') || ''),
    eligible_countries: coerceStringArray(getField('eligible_countries')),
    eligible_regions: coerceStringArray(getField('eligible_regions')),
    host_countries: coerceStringArray(getField('host_countries')),
    funder_country: String(getField('funder_country') || ''),
    funding_kinds: coerceStringArray(getField('funding_kinds')),
    institution_types: coerceStringArray(getField('institution_types')),
    career_stages: coerceStringArray(getField('career_stages')),
    citizenship_requirements: coerceStringArray(getField('citizenship_requirements')),
    residency_requirements: coerceStringArray(getField('residency_requirements')),
    application_languages: coerceStringArray(getField('application_languages')),
    disciplines: coerceStringArray(getField('disciplines')),
    amount_min: coerceNumber(getField('amount_min')),
    amount_max: coerceNumber(getField('amount_max')),
    currency: String(getField('currency') || ''),
    project_duration_min_months: coerceNumber(getField('project_duration_min_months')),
    project_duration_max_months: coerceNumber(getField('project_duration_max_months')),
    project_duration_text: String(getField('project_duration_text') || ''),
    eligibility_text: String(getField('eligibility_text') || ''),
    expected_deliverables_text: String(getField('expected_deliverables_text') || ''),
    official_urls: coerceStringArray(getField('official_urls')),
    contact_info: String(getField('contact_info') || ''),
    sponsor_type: String(getField('sponsor_type') || ''),
  };
}

export function extractConfidenceMap(payload: FundingExtractionPayload): Record<string, number> {
  return Object.fromEntries(
    Object.entries(payload.fields).map(([key, value]) => [key, value.confidence])
  );
}

export function extractEvidenceMap(payload: FundingExtractionPayload): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(payload.fields).map(([key, value]) => [key, value.evidence || null])
  );
}

export function extractMissingFieldKeys(payload: FundingExtractionPayload): string[] {
  return Object.entries(payload.fields)
    .filter(([, value]) => value.is_missing)
    .map(([key]) => key);
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
