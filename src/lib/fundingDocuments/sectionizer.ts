// @ts-nocheck
import { FUNDING_CALL_INGEST_TASK_CODE, runFundingGatewayText } from '@/lib/funding/llmRouting';
import {
  FUNDING_DOCUMENT_SECTION_TYPES,
  FUNDING_DOC_SECTION_CLASSIFY_STAGE_CODE,
  inferSectionTypeFromTitle,
  isFundingDocumentSectionType,
  type FundingDocumentSectionType,
} from './constants';
import type { FundingDocumentParsedPage, FundingDocumentParserContext, FundingDocumentSectionDraft } from './types';

type CandidateSection = {
  title: string | null;
  lines: string[];
  startPage: number;
  endPage: number;
  orderIndex: number;
  sectionType: FundingDocumentSectionType | null;
  confidence: number;
  method: 'heading' | 'fallback';
};

function normalizeHeadingText(line: string) {
  return line
    .replace(/^\s*(?:section|chapter|part)?\s*\d+(?:\.\d+)*[\).:-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFundingDocumentHeadingLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 140) {
    return false;
  }
  if (/^\d+(?:\.\d+)*[\).:-]?\s+\S+/.test(trimmed)) {
    return true;
  }
  if (/^[A-Z0-9][A-Z0-9\s/&(),.-]{5,}$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    return true;
  }
  if (inferSectionTypeFromTitle(trimmed) && trimmed.length <= 90 && !/[.!?]$/.test(trimmed)) {
    return true;
  }
  if (/^[A-Z][A-Za-z0-9\s/&(),.-]{2,80}:$/.test(trimmed)) {
    return true;
  }
  return false;
}

function pushCandidate(candidates: CandidateSection[], current: CandidateSection | null) {
  if (!current) {
    return;
  }
  const text = current.lines.join('\n').trim();
  if (!text) {
    return;
  }
  candidates.push({
    ...current,
    lines: [text],
  });
}

function buildHeadingCandidates(pages: FundingDocumentParsedPage[]): CandidateSection[] {
  const candidates: CandidateSection[] = [];
  let current: CandidateSection | null = null;
  let orderIndex = 0;

  for (const page of pages) {
    const lines = page.cleanedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (isFundingDocumentHeadingLine(line)) {
        pushCandidate(candidates, current);
        const title = normalizeHeadingText(line.replace(/:$/, ''));
        const sectionType = inferSectionTypeFromTitle(title);
        current = {
          title,
          lines: [],
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          orderIndex,
          sectionType,
          confidence: sectionType ? 0.86 : 0.55,
          method: 'heading',
        };
        orderIndex += 1;
        continue;
      }

      if (!current) {
        current = {
          title: null,
          lines: [],
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          orderIndex,
          sectionType: inferSectionTypeFromTitle(line),
          confidence: 0.45,
          method: 'fallback',
        };
        orderIndex += 1;
      }

      current.lines.push(line);
      current.endPage = page.pageNumber;
    }
  }

  pushCandidate(candidates, current);
  return candidates;
}

function fallbackSections(pages: FundingDocumentParsedPage[]): FundingDocumentSectionDraft[] {
  return pages
    .filter((page) => page.cleanedText.trim())
    .map((page, index) => ({
      sectionType: inferSectionTypeFromTitle(page.cleanedText.slice(0, 160)) || 'other',
      sectionTitle: page.pageNumber > 0 ? `Page ${page.pageNumber}` : 'Document',
      sectionText: page.cleanedText,
      startPage: page.pageNumber,
      endPage: page.pageNumber,
      orderIndex: index,
      confidence: 0.35,
      classificationMethod: 'fallback',
    }));
}

function extractJsonArray(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  return JSON.parse(match[0]);
}

async function classifyAmbiguousSections(
  candidates: CandidateSection[],
  context?: FundingDocumentParserContext | null
) {
  const ambiguous = candidates.filter((candidate) => !candidate.sectionType);
  if (ambiguous.length === 0) {
    return new Map<number, { sectionType: FundingDocumentSectionType; confidence: number }>();
  }

  const promptPayload = ambiguous.map((candidate) => ({
    orderIndex: candidate.orderIndex,
    title: candidate.title,
    preview: candidate.lines.join('\n').slice(0, 300),
  }));

  try {
    const response = await runFundingGatewayText({
      taskCode: FUNDING_CALL_INGEST_TASK_CODE,
      stageCode: FUNDING_DOC_SECTION_CLASSIFY_STAGE_CODE,
      prompt: `Classify funding-call document sections.

Allowed sectionType values:
${FUNDING_DOCUMENT_SECTION_TYPES.join(', ')}

Return JSON array only. Each item must be:
{"orderIndex": number, "sectionType": "one allowed value", "confidence": number between 0 and 1}

Sections:
${JSON.stringify(promptPayload, null, 2)}`,
      context,
      responseMimeType: 'application/json',
      maxTokensOut: 2500,
      temperature: 0,
      metadata: {
        purpose: 'funding_document_section_classification',
        sectionCount: ambiguous.length,
      },
    });

    const parsed = extractJsonArray(response?.rawText || '');
    const byOrder = new Map<number, { sectionType: FundingDocumentSectionType; confidence: number }>();
    for (const item of Array.isArray(parsed) ? parsed : []) {
      const sectionType = String(item?.sectionType || '');
      if (Number.isInteger(item?.orderIndex) && isFundingDocumentSectionType(sectionType)) {
        byOrder.set(item.orderIndex, {
          sectionType,
          confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(item.confidence, 1)) : 0.6,
        });
      }
    }
    return byOrder;
  } catch (error) {
    console.warn('[FundingDocuments] Section classification LLM fallback failed', error);
    return new Map<number, { sectionType: FundingDocumentSectionType; confidence: number }>();
  }
}

export async function sectionizeFundingDocument(
  pages: FundingDocumentParsedPage[],
  context?: FundingDocumentParserContext | null
): Promise<FundingDocumentSectionDraft[]> {
  const usablePages = pages.filter((page) => page.cleanedText.trim());
  if (usablePages.length === 0) {
    return [];
  }

  const candidates = buildHeadingCandidates(usablePages);
  const meaningfulHeadings = candidates.filter((candidate) => candidate.method === 'heading').length;
  if (candidates.length === 0 || meaningfulHeadings === 0) {
    return fallbackSections(usablePages);
  }

  const llmClassifications = await classifyAmbiguousSections(candidates, context);

  return candidates.map((candidate, index) => {
    const llm = llmClassifications.get(candidate.orderIndex);
    const sectionType = candidate.sectionType || llm?.sectionType || 'other';
    const classificationMethod = candidate.sectionType
      ? 'heading'
      : llm
        ? 'llm'
        : candidate.method === 'heading'
          ? 'fallback'
          : 'fallback';

    return {
      sectionType,
      sectionTitle: candidate.title,
      sectionText: candidate.lines.join('\n').trim(),
      startPage: candidate.startPage,
      endPage: candidate.endPage,
      orderIndex: index,
      confidence: candidate.sectionType ? candidate.confidence : llm?.confidence ?? 0.4,
      classificationMethod,
    };
  });
}
