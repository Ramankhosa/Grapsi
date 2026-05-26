import {
  LLM_EXTRACTABLE_FUNDING_FIELD_KEYS,
  type FundingFieldKey,
} from './constants';
import { fundingIntakeStructuredOutputSchema, type FundingIntakeStructuredOutput } from './schemas';
import type { FundingEvidenceAnchor } from './types';
import {
  normalizeFieldValue,
  normalizeMultilineText,
  parseJsonResponse,
} from './utils';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isMissingStructuredValue(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
}

function coerceStructuredText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => coerceStructuredText(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join('\n') : null;
  }

  const record = asRecord(value);
  if (record) {
    for (const key of ['value', 'quote', 'text', 'label', 'name', 'title', 'summary', 'description']) {
      if (hasOwn(record, key)) {
        const nested = coerceStructuredText(record[key]);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }

  const text = normalizeMultilineText(String(value));
  return text || null;
}

function coerceStructuredEvidence(value: unknown): FundingEvidenceAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const anchors: FundingEvidenceAnchor[] = [];

  value.forEach((item) => {
    const record = asRecord(item);
    if (!record) {
      return;
    }

    const segmentId = coerceStructuredText(record.segmentId ?? record.segment_id ?? record.id);
    const quote = coerceStructuredText(record.quote ?? record.text);
    if (!segmentId || !quote) {
      return;
    }

    anchors.push({
      sourceType: 'segment',
      segmentId,
      quote,
      heading: coerceStructuredText(record.heading),
    });
  });

  return anchors;
}

function coerceStructuredStatus(rawStatus: unknown, value: unknown): 'supported' | 'unsupported' | 'ambiguous' {
  if (rawStatus === 'supported' || rawStatus === 'unsupported' || rawStatus === 'ambiguous') {
    return rawStatus;
  }

  return isMissingStructuredValue(value) ? 'unsupported' : 'supported';
}

function coerceStructuredConfidence(rawConfidence: unknown, status: 'supported' | 'unsupported' | 'ambiguous'): number {
  const confidence = Number(rawConfidence);
  if (Number.isFinite(confidence)) {
    return Math.max(0, Math.min(1, confidence));
  }

  return status === 'unsupported' ? 0 : 0.85;
}

function coerceStructuredFieldForSchema(fieldKey: FundingFieldKey, candidate: unknown) {
  const record = asRecord(candidate);
  const rawValue = record && hasOwn(record, 'value') ? record.value : candidate;
  const value = isMissingStructuredValue(rawValue)
    ? null
    : normalizeFieldValue(fieldKey, rawValue);
  const normalizedValue = isMissingStructuredValue(value) ? null : value;
  const status = coerceStructuredStatus(record?.status, normalizedValue);

  return {
    status,
    confidence: coerceStructuredConfidence(record?.confidence, status),
    evidence: coerceStructuredEvidence(record?.evidence),
    value: normalizedValue,
  };
}

function coerceCoreExtractionForSchema(raw: unknown): unknown {
  const root = asRecord(raw) || {};
  const rawFields = asRecord(root.fields) || {};
  const fields: Record<string, unknown> = {};

  for (const fieldKey of LLM_EXTRACTABLE_FUNDING_FIELD_KEYS) {
    const candidate = hasOwn(rawFields, fieldKey)
      ? rawFields[fieldKey]
      : root[fieldKey];
    fields[fieldKey] = coerceStructuredFieldForSchema(fieldKey, candidate);
  }

  return {
    ...root,
    fields,
    warnings: Array.isArray(root.warnings)
      ? root.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
      : [],
  };
}

export function parseCoreExtractorPayload(rawText: string): FundingIntakeStructuredOutput {
  const parsedJson = parseJsonResponse(rawText);
  return fundingIntakeStructuredOutputSchema.parse(coerceCoreExtractionForSchema(parsedJson));
}
