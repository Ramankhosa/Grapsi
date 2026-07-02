import { PROTECTED_SINGLE_CHUNK_SECTION_TYPES } from './constants';
import type { FundingDocumentChunkDraft, FundingDocumentSectionDraft } from './types';

const DEFAULT_TARGET_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;

export function estimateFundingDocumentTokens(text: string) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function getChunkTargetTokens() {
  const configured = Number(process.env.FUNDING_DOC_CHUNK_TOKENS || DEFAULT_TARGET_TOKENS);
  return Number.isFinite(configured) ? Math.max(128, Math.min(configured, 2000)) : DEFAULT_TARGET_TOKENS;
}

function getChunkOverlapTokens(targetTokens: number) {
  const configured = Number(process.env.FUNDING_DOC_CHUNK_OVERLAP || DEFAULT_OVERLAP_TOKENS);
  const overlap = Number.isFinite(configured) ? configured : DEFAULT_OVERLAP_TOKENS;
  return Math.max(0, Math.min(overlap, Math.floor(targetTokens / 2)));
}

function splitParagraphs(text: string) {
  return String(text || '')
    .split(/\n{2,}|\n(?=[A-Z0-9][A-Za-z0-9\s/&(),.-]{0,120}:?$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitOversizedText(text: string, targetChars: number) {
  const sentences = text.match(/[^.!?]+[.!?]+|\S[\s\S]{0,220}(?=\s|$)/g) || [text];
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length > targetChars && current) {
      parts.push(current.trim());
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function buildTextChunks(text: string, targetTokens: number, overlapTokens: number) {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const chunks: string[] = [];
  let current = '';

  const units = splitParagraphs(text).flatMap((paragraph) =>
    paragraph.length > targetChars * 1.25 ? splitOversizedText(paragraph, targetChars) : [paragraph]
  );

  for (const unit of units) {
    const next = current ? `${current}\n\n${unit}` : unit;
    if (next.length > targetChars && current) {
      chunks.push(current.trim());
      const overlap = overlapChars > 0 ? current.slice(Math.max(0, current.length - overlapChars)).trim() : '';
      current = overlap ? `${overlap}\n\n${unit}` : unit;
    } else {
      current = next;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

export function chunkFundingDocumentSections(sections: FundingDocumentSectionDraft[]): FundingDocumentChunkDraft[] {
  const targetTokens = getChunkTargetTokens();
  const overlapTokens = getChunkOverlapTokens(targetTokens);
  const chunks: FundingDocumentChunkDraft[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const text = section.sectionText.trim();
    if (!text) {
      continue;
    }

    const tokenCount = estimateFundingDocumentTokens(text);
    const shouldKeepWhole =
      PROTECTED_SINGLE_CHUNK_SECTION_TYPES.has(section.sectionType) &&
      tokenCount <= targetTokens * 2;

    const textChunks = shouldKeepWhole
      ? [text]
      : buildTextChunks(text, targetTokens, overlapTokens);

    for (const chunkText of textChunks) {
      chunks.push({
        sourceSectionOrderIndex: section.orderIndex,
        sectionType: section.sectionType,
        chunkIndex,
        chunkText,
        pageStart: section.startPage,
        pageEnd: section.endPage,
        tokenCount: estimateFundingDocumentTokens(chunkText),
      });
      chunkIndex += 1;
    }
  }

  return chunks;
}
