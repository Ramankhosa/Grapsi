import crypto from 'crypto';

import { TaskCode } from '@prisma/client';

import { llmGateway } from '@/lib/metering/gateway';
import type { TenantContext } from '@/lib/metering';
import { systemPromptTemplateService, TEMPLATE_KEYS } from '@/lib/services/system-prompt-template-service';
import {
  buildExportProfileJsonSchemaText,
  EXPORT_FONT_REGISTRY,
  normalizeExportProfilePartial,
  type PartialExportProfile,
} from '@/lib/export/export-profile-schema';

const EXPORT_EXTRACTION_STAGE_CODE = 'PAPER_EXPORT_EXTRACTION';
const MAX_SOURCE_CHARS = 8000;
const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-tex',
  'text/x-tex',
  'text/plain',
]);

const FALLBACK_EXPORT_EXTRACTION_PROMPT = `You are an academic formatting expert.
Analyze the supplied reference content and extract the export settings that should drive DOCX and LaTeX export.

Rules:
- Return ONLY valid JSON.
- Match the provided schema exactly and do not invent extra keys.
- If a value cannot be determined, use null for that field and 0 for its field confidence.
- If the setting is explicitly stated or directly visible, confidence should be at least 0.8.
- If the setting is inferred from conventions, confidence should be between 0.5 and 0.7.
- If the setting is a weak guess, confidence must be below 0.5.
- Never hallucinate venue requirements.
- Prefer concrete LaTeX commands when a .tex reference is supplied.
- Use only fonts from the curated font registry when you can match confidently.

Output expectations:
- fieldConfidences should use field names or nested paths such as "margins.topCm".
- documentClass should be one of the supported schema values.
- latexPackages should contain package names only, without \\usepackage wrappers.
- latexPreambleExtra may contain only safe preamble lines; do not include \\input, \\include, \\write18, shell escapes, or document body content.
- sourceDescription should briefly describe what evidence you used.`;

export interface ExtractExportProfileInput {
  headers?: Record<string, string>;
  tenantContext?: TenantContext | null;
  sessionId: string;
  fileBuffer?: Buffer | null;
  fileName?: string | null;
  mimeType?: string | null;
  pastedText?: string | null;
}

export interface ExtractedExportProfileResult {
  profile: PartialExportProfile;
  confidence: number;
  extractionModel: string | null;
  extractionTokensIn: number;
  extractionTokensOut: number;
  sourceType: 'file' | 'pasted_text';
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceFileHash: string | null;
  sourcePreview: string;
}

export async function extractExportProfile(
  input: ExtractExportProfileInput,
): Promise<ExtractedExportProfileResult> {
  const source = await prepareExtractionSource(input);
  const systemPrompt = await systemPromptTemplateService.resolveWithFallback(
    {
      templateKey: TEMPLATE_KEYS.PAPER_EXPORT_EXTRACTION,
      applicationMode: 'paper',
    },
    FALLBACK_EXPORT_EXTRACTION_PROMPT,
  );

  const prompt = buildExtractionPrompt(systemPrompt, source.preview, source.hints);
  const llmRequestContext = input.tenantContext
    ? { tenantContext: input.tenantContext }
    : { headers: input.headers || {} };
  const llmResult = await llmGateway.executeLLMOperation(
    llmRequestContext,
    {
      taskCode: TaskCode.LLM2_DRAFT,
      stageCode: EXPORT_EXTRACTION_STAGE_CODE,
      prompt,
      inputTokens: estimateTokens(prompt),
      parameters: {
        temperature: 0.1,
        max_output_tokens: 2500,
      },
      metadata: {
        sessionId: input.sessionId,
        feature: 'adaptive_export',
        sourceType: source.sourceType,
      },
      idempotencyKey: `export-profile:${input.sessionId}:${source.sourceFileHash || crypto.randomUUID()}`,
    },
  );

  if (!llmResult.success || !llmResult.response) {
    throw new Error(llmResult.error?.message || 'Failed to extract export settings');
  }

  const rawOutput = llmResult.response.output || '';
  let parsed: unknown;

  try {
    parsed = parseJsonObject(rawOutput);
  } catch (error) {
    const retryPrompt = `${prompt}\n\nYour previous response was invalid JSON. Return only a valid JSON object.`;
    const retryResult = await llmGateway.executeLLMOperation(
      llmRequestContext,
      {
        taskCode: TaskCode.LLM2_DRAFT,
        stageCode: EXPORT_EXTRACTION_STAGE_CODE,
        prompt: retryPrompt,
        inputTokens: estimateTokens(retryPrompt),
        parameters: {
          temperature: 0,
          max_output_tokens: 2500,
        },
        metadata: {
          sessionId: input.sessionId,
          feature: 'adaptive_export_retry',
          sourceType: source.sourceType,
        },
        idempotencyKey: `export-profile-retry:${input.sessionId}:${source.sourceFileHash || crypto.randomUUID()}`,
      },
    );

    if (!retryResult.success || !retryResult.response) {
      throw new Error(llmResult.error?.message || 'Failed to extract export settings');
    }

    parsed = parseJsonObject(retryResult.response.output || '');

    return buildExtractionResult(source, parsed, retryResult.response);
  }

  return buildExtractionResult(source, parsed, llmResult.response);
}

async function prepareExtractionSource(
  input: ExtractExportProfileInput,
): Promise<{
  sourceType: 'file' | 'pasted_text';
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceFileHash: string | null;
  preview: string;
  hints: string;
}> {
  const pastedText = String(input.pastedText || '').trim();
  if (pastedText) {
    return {
      sourceType: 'pasted_text',
      sourceFileName: null,
      sourceMimeType: 'text/plain',
      sourceFileHash: hashBuffer(Buffer.from(pastedText, 'utf8')),
      preview: truncateText(pastedText),
      hints: 'Input mode: pasted formatting guidelines.',
    };
  }

  const buffer = input.fileBuffer;
  if (!buffer || buffer.length === 0) {
    throw new Error('No export reference provided');
  }

  const fileName = String(input.fileName || '').trim() || null;
  const mimeType = normalizeMimeType(input.mimeType, fileName);
  if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported reference file type. Use .docx or .tex.');
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const extracted = await extractDocxReference(buffer);
    return {
      sourceType: 'file',
      sourceFileName: fileName,
      sourceMimeType: mimeType,
      sourceFileHash: hashBuffer(buffer),
      preview: truncateText(extracted.preview),
      hints: extracted.hints,
    };
  }

  const texContent = buffer.toString('utf8');
  const texHints = extractTexHints(texContent);
  const hintText = buildTexHintSummary(texHints);
  return {
    sourceType: 'file',
    sourceFileName: fileName,
    sourceMimeType: mimeType,
    sourceFileHash: hashBuffer(buffer),
    preview: truncateText(texContent),
    hints: hintText,
  };
}

async function extractDocxReference(buffer: Buffer): Promise<{ preview: string; hints: string }> {
  const mammoth = loadModule('mammoth');
  const AdmZip = loadModule('adm-zip');

  const rawTextResult = await mammoth.extractRawText({ buffer });
  const zip = new AdmZip(buffer);
  const stylesXml = safeReadZipEntry(zip, 'word/styles.xml');
  const settingsXml = safeReadZipEntry(zip, 'word/settings.xml');
  const numberingXml = safeReadZipEntry(zip, 'word/numbering.xml');
  const sectionInfo = [
    rawTextResult?.value ? `DOCX body text:\n${rawTextResult.value.trim()}` : '',
    stylesXml ? `DOCX styles.xml excerpt:\n${compactXml(stylesXml)}` : '',
    settingsXml ? `DOCX settings.xml excerpt:\n${compactXml(settingsXml)}` : '',
    numberingXml ? `DOCX numbering.xml excerpt:\n${compactXml(numberingXml)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const hints = [
    'Input mode: DOCX reference document.',
    stylesXml ? 'Style metadata was extracted from word/styles.xml.' : 'No styles.xml metadata was available.',
    settingsXml ? 'Document settings metadata was extracted from word/settings.xml.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    preview: sectionInfo || rawTextResult?.value || '',
    hints,
  };
}

function buildExtractionPrompt(systemPrompt: string, documentContent: string, hints: string): string {
  const fontRegistry = EXPORT_FONT_REGISTRY
    .map((font) => `- ${font.name} (${font.category})`)
    .join('\n');

  return `${systemPrompt}

Curated font registry:
${fontRegistry}

ExportProfile JSON schema:
${buildExportProfileJsonSchemaText()}

Reference hints:
${hints || 'No extra hints available.'}

Document content:
---
${documentContent}
---`;
}

function buildExtractionResult(
  source: {
    sourceType: 'file' | 'pasted_text';
    sourceFileName: string | null;
    sourceMimeType: string | null;
    sourceFileHash: string | null;
    preview: string;
  },
  parsed: unknown,
  response: { outputTokens: number; metadata?: Record<string, unknown> },
): ExtractedExportProfileResult {
  const sanitized = stripNulls(parsed);
  const normalized = normalizeExportProfilePartial(sanitized);
  const metadata = response.metadata && typeof response.metadata === 'object'
    ? response.metadata
    : {};
  const tokenUsage = metadata.tokenUsage && typeof metadata.tokenUsage === 'object'
    ? metadata.tokenUsage as Record<string, unknown>
    : {};
  const extractionTokensIn = readTokenValue(tokenUsage.inputTokens ?? metadata.inputTokens);
  const extractionTokensOut = readTokenValue(tokenUsage.outputTokens ?? metadata.outputTokens ?? response.outputTokens);
  const confidence = typeof normalized.extractionConfidence === 'number'
    ? normalized.extractionConfidence
    : averageConfidence(normalized.fieldConfidences);

  return {
    profile: {
      ...normalized,
      extractionConfidence: confidence,
    },
    confidence,
    extractionModel: readStringValue(metadata.resolvedModelCode ?? metadata.providerModel ?? metadata.modelCode),
    extractionTokensIn,
    extractionTokensOut,
    sourceType: source.sourceType,
    sourceFileName: source.sourceFileName,
    sourceMimeType: source.sourceMimeType,
    sourceFileHash: source.sourceFileHash,
    sourcePreview: source.preview,
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty extraction response');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in extraction response');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => stripNulls(item)).filter((item) => item !== undefined);
    return items;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, stripNulls(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);
    return Object.fromEntries(entries);
  }

  if (value === null) return undefined;
  return value;
}

function extractTexHints(content: string): {
  documentClass?: string;
  documentClassOptions?: string[];
  latexPackages?: string[];
  bibliographyStyle?: string;
  fontSizePt?: number;
  columnLayout?: 1 | 2;
  pageSize?: string;
  geometryOptions?: string;
} {
  const match = content.match(/\\documentclass(?:\[([^\]]+)])?\{([^}]+)\}/i);
  const documentClass = match?.[2]?.trim();
  const documentClassOptions = match?.[1]
    ? match[1].split(',').map((entry) => entry.trim()).filter(Boolean)
    : [];

  const packageMatches = Array.from(content.matchAll(/\\usepackage(?:\[[^\]]*])?\{([^}]+)\}/gi));
  const latexPackages = Array.from(new Set(
    packageMatches
      .flatMap((entry) => entry[1].split(','))
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));

  const bibliographyStyle = content.match(/\\bibliographystyle\{([^}]+)\}/i)?.[1]?.trim();
  const fontSizeOption = documentClassOptions.find((option) => /^(10|11|12)pt$/i.test(option));
  const fontSizePt = fontSizeOption ? Number(fontSizeOption.replace(/pt/i, '')) : undefined;
  const columnLayout = documentClassOptions.some((option) => option.toLowerCase() === 'twocolumn') ? 2 : undefined;
  const pageSize = documentClassOptions.some((option) => option.toLowerCase() === 'letterpaper')
    ? 'LETTER'
    : documentClassOptions.some((option) => option.toLowerCase() === 'a4paper')
    ? 'A4'
    : undefined;
  const geometryOptions = content.match(/\\usepackage\[([^\]]+)]\{geometry\}/i)?.[1]?.trim();

  return {
    documentClass,
    documentClassOptions: documentClassOptions.length > 0 ? documentClassOptions : undefined,
    latexPackages: latexPackages.length > 0 ? latexPackages : undefined,
    bibliographyStyle,
    fontSizePt,
    columnLayout,
    pageSize,
    geometryOptions,
  };
}

function buildTexHintSummary(hints: ReturnType<typeof extractTexHints>): string {
  const parts = ['Input mode: LaTeX reference document.'];

  if (hints.documentClass) {
    parts.push(`Detected \\documentclass=${hints.documentClass}.`);
  }
  if (hints.documentClassOptions?.length) {
    parts.push(`Detected class options: ${hints.documentClassOptions.join(', ')}.`);
  }
  if (hints.latexPackages?.length) {
    parts.push(`Detected packages: ${hints.latexPackages.join(', ')}.`);
  }
  if (hints.geometryOptions) {
    parts.push(`Detected geometry options: ${hints.geometryOptions}.`);
  }
  if (hints.bibliographyStyle) {
    parts.push(`Detected bibliography style: ${hints.bibliographyStyle}.`);
  }

  return parts.join(' ');
}

function safeReadZipEntry(zip: any, entryName: string): string {
  try {
    const entry = zip.getEntry(entryName);
    if (!entry) return '';
    return String(zip.readAsText(entry) || '');
  } catch {
    return '';
  }
}

function compactXml(value: string): string {
  return value
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function truncateText(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= MAX_SOURCE_CHARS) return normalized;
  return normalized.slice(0, MAX_SOURCE_CHARS);
}

function normalizeMimeType(mimeType: string | null | undefined, fileName: string | null): string | null {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(normalizedMime)) return normalizedMime;

  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lowerName.endsWith('.tex')) {
    return 'application/x-tex';
  }
  if (lowerName.endsWith('.txt')) {
    return 'text/plain';
  }
  return normalizedMime || null;
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function averageConfidence(fieldConfidences: Record<string, number> | undefined): number {
  const values = Object.values(fieldConfidences || {}).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length));
}

function readTokenValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function loadModule(moduleName: string): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const req = eval('require') as (name: string) => any;
  return req(moduleName);
}
