// @ts-nocheck
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import mammoth from 'mammoth';

import { buildPdfFileContentPart, FUNDING_CALL_INGEST_TASK_CODE, runFundingGatewayExtraction } from '@/lib/funding/llmRouting';
import { reconstructPageText } from '@/lib/services/proactive-parsing-service';
import { FUNDING_DOC_PAGE_TRANSCRIBE_STAGE_CODE } from './constants';
import type { FundingDocumentParsedPage, FundingDocumentParserContext, FundingDocumentParseResult } from './types';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => {
      try {
        const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
        const workerPath = path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
        if (fsSync.existsSync(workerPath)) {
          mod.GlobalWorkerOptions.workerSrc = `file://${workerPath.replace(/\\/g, '/')}`;
        }
      } catch {
        console.warn('[FundingDocuments] Could not resolve pdfjs worker path, using main-thread fallback');
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

function normalizeLine(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function isStandalonePageNumber(line: string) {
  return /^(?:page\s*)?\d{1,4}(?:\s*of\s*\d{1,4})?$/i.test(line.trim());
}

function buildRepeatedHeaderFooterSet(rawPages: string[]) {
  const pageCount = rawPages.length;
  const threshold = Math.max(2, Math.floor(pageCount * 0.6));
  const counts = new Map<string, number>();

  for (const page of rawPages) {
    const lines = page
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter(Boolean);
    const candidates = new Set([...lines.slice(0, 4), ...lines.slice(-4)]);
    for (const line of candidates) {
      if (line.length >= 4 && !isStandalonePageNumber(line)) {
        counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) || 0) + 1);
      }
    }
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line)
  );
}

export function cleanFundingDocumentPageText(rawText: string, repeatedHeaderFooterLines = new Set<string>()) {
  const dehyphenated = String(rawText || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2');

  const outputLines: string[] = [];
  for (const rawLine of dehyphenated.split('\n')) {
    const line = normalizeLine(rawLine);
    if (!line) {
      continue;
    }
    if (isStandalonePageNumber(line)) {
      continue;
    }
    if (repeatedHeaderFooterLines.has(line.toLowerCase())) {
      continue;
    }
    if (outputLines[outputLines.length - 1]?.toLowerCase() === line.toLowerCase()) {
      continue;
    }
    outputLines.push(line);
  }

  return outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanFundingDocumentPages(rawPages: Array<{ pageNumber: number; rawText: string; extractionConfidence?: number }>): FundingDocumentParsedPage[] {
  const repeated = buildRepeatedHeaderFooterSet(rawPages.map((page) => page.rawText));
  return rawPages.map((page) => ({
    pageNumber: page.pageNumber,
    rawText: page.rawText || '',
    cleanedText: cleanFundingDocumentPageText(page.rawText || '', repeated),
    extractionConfidence: page.extractionConfidence ?? 0.95,
  }));
}

async function transcribePdfPageWithGateway(filePath: string, pageNumber: number, context?: FundingDocumentParserContext | null) {
  try {
    const contentPart = await buildPdfFileContentPart(filePath);
    const response = await runFundingGatewayExtraction({
      stageCode: FUNDING_DOC_PAGE_TRANSCRIBE_STAGE_CODE,
      prompt: `Transcribe page ${pageNumber} of this funding-call PDF. Return JSON only: {"text":"page text"}. If the page has no useful text, return {"text":""}.`,
      context,
      contentParts: [contentPart],
      responseMimeType: 'application/json',
      maxTokensOut: 6000,
      temperature: 0,
      metadata: {
        purpose: 'funding_document_page_transcription',
        pageNumber,
      },
    });

    const raw = response?.rawText || '';
    const parsed = raw.match(/\{[\s\S]*\}/) ? JSON.parse(raw.match(/\{[\s\S]*\}/)![0]) : null;
    return typeof parsed?.text === 'string' ? parsed.text : raw;
  } catch (error) {
    console.warn(`[FundingDocuments] PDF page ${pageNumber} transcription failed`, error);
    return '';
  }
}

async function extractPdfPages(filePath: string, context?: FundingDocumentParserContext | null) {
  const pdfjs = await getPdfjs();
  const fileBuffer = await fs.readFile(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages: Array<{ pageNumber: number; rawText: string; extractionConfidence: number }> = [];
  const fallbackPages: number[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const textItems = content.items
      .filter((item: any) => typeof item.str === 'string')
      .map((item: any) => ({
        str: item.str,
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
        width: item.width || 0,
      }));

    let rawText = reconstructPageText(textItems, viewport.width).trim();
    let extractionConfidence = 0.95;

    if (rawText.replace(/\s+/g, '').length < 30) {
      const fallbackText = await transcribePdfPageWithGateway(filePath, pageNumber, context);
      if (fallbackText.trim()) {
        rawText = fallbackText.trim();
        extractionConfidence = 0.65;
        fallbackPages.push(pageNumber);
      }
    }

    pages.push({ pageNumber, rawText, extractionConfidence });
  }

  return { pages, fallbackPages };
}

async function extractDocxPages(filePath: string) {
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ path: filePath }),
    mammoth.convertToHtml({ path: filePath }),
  ]);

  const headingLines = Array.from(String(html.value || '').matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
    .map((match) => match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const headingSet = new Set(headingLines.map((line) => line.toLowerCase()));
  const lines = String(raw.value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const decoratedLines = lines.map((line) => (headingSet.has(line.toLowerCase()) ? line.toUpperCase() : line));

  return {
    pages: [
      {
        pageNumber: 0,
        rawText: decoratedLines.join('\n'),
        extractionConfidence: 0.9,
      },
    ],
    fallbackPages: [],
  };
}

/**
 * Plain-text extraction for DOCX intake sources (mammoth, no LLM). Used by the
 * intake pipeline where only text is needed, not page/section structure.
 */
export async function extractDocxPlainText(filePath: string): Promise<string> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const { pages } = await extractDocxPages(absolutePath);
  return pages.map((page) => page.rawText).join('\n\n').trim();
}

export async function parseFundingDocument(
  filePath: string,
  mimeType: string,
  context?: FundingDocumentParserContext | null
): Promise<FundingDocumentParseResult> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const lowerMime = String(mimeType || '').toLowerCase();
  const lowerName = absolutePath.toLowerCase();

  let extracted: { pages: Array<{ pageNumber: number; rawText: string; extractionConfidence?: number }>; fallbackPages: number[] };
  let extractor: FundingDocumentParseResult['stats']['extractor'];

  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) {
    extracted = await extractPdfPages(absolutePath, context);
    extractor = extracted.fallbackPages.length > 0 ? 'mixed' : 'pdfjs';
  } else if (
    lowerMime.includes('officedocument.wordprocessingml.document') ||
    lowerMime.includes('application/vnd.openxmlformats') ||
    lowerName.endsWith('.docx')
  ) {
    extracted = await extractDocxPages(absolutePath);
    extractor = 'mammoth';
  } else if (lowerMime.includes('text/plain') || lowerName.endsWith('.txt')) {
    // Text-backed documents (pasted intake text, fetched web pages) are a single
    // logical page so downstream sectionizing/chunking works unchanged.
    const rawText = await fs.readFile(absolutePath, 'utf8');
    extracted = {
      pages: [{ pageNumber: 1, rawText, extractionConfidence: 1 }],
      fallbackPages: [],
    };
    extractor = 'text';
  } else {
    throw new Error('Only PDF, DOCX, and plain-text funding documents are supported');
  }

  const pages = cleanFundingDocumentPages(extracted.pages);
  return {
    pages,
    stats: {
      pageCount: pages.length,
      rawCharCount: pages.reduce((sum, page) => sum + page.rawText.length, 0),
      cleanedCharCount: pages.reduce((sum, page) => sum + page.cleanedText.length, 0),
      extractor,
      fallbackPages: extracted.fallbackPages.length > 0 ? extracted.fallbackPages : undefined,
    },
  };
}
