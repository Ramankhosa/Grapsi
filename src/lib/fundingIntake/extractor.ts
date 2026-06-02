import fs from 'fs/promises';
import path from 'path';
import { generateJsonFromDeepSeek } from '../deepseekService';
import {
  buildPdfFileContentPart,
  FUNDING_CALL_INGEST_PDF_STAGE_CODE,
  FUNDING_CALL_INGEST_TEXT_STAGE_CODE,
  runFundingGatewayExtraction,
  type FundingLlmRoutingContext,
} from '../funding/llmRouting';
import { parseStructuredFromOpenAI } from '../openaiService';
import {
  FUNDING_INTAKE_EXTRACTOR_VERSION,
  FUNDING_INTAKE_PROMPT_VERSION,
  LLM_EXTRACTABLE_FUNDING_FIELD_KEYS,
} from './constants';
import { parseCoreExtractorPayload } from './coreExtractionPayload';
import { fundingIntakeStructuredOutputSchema, type FundingIntakeStructuredOutput } from './schemas';
import type {
  FundingExtractionPayload,
  FundingExtractionValidationIssue,
  FundingSourceSegment,
} from './types';
import {
  buildFundingSourceSegments,
  normalizeExtractionPayload,
  normalizeMultilineText,
  parseJsonResponse,
  validateFundingExtractionPayload,
} from './utils';

const SYSTEM_INSTRUCTIONS = `
You extract core funding opportunity facts from normalized source segments.
Return only facts explicitly supported by the supplied segments.
Every non-null value must include one or more evidence anchors that reference the segment id and quote exact text from that segment.
If a field is unsupported, return value=null, status="unsupported", confidence=0, evidence=[].
If the source contains conflicting values for the same field, do not choose one. Return value=null, status="ambiguous", and include evidence for the conflicting support.
Do not invent URLs, contacts, sponsor type, funder country, open date, or duration month counts.
Description is not a freeform summary. Return evidence-backed source snippets for description; downstream code will build the stored description deterministically from those snippets.
Use short exact quotes copied from the supplied segments. Never cite a segment id that was not provided.
`;

const PDF_TRANSCRIPTION_SYSTEM_INSTRUCTIONS = `
You transcribe funding call source documents into clean plain text.
Do not summarize or omit sections.
Preserve the reading order of the document.
Keep headings, bullet points, tables, deadlines, URLs, and eligibility text whenever they are visible.
Return strict JSON only.
`;

function buildSegmentPrompt(segments: FundingSourceSegment[]): string {
  const serializedSegments = segments
    .map((segment) => {
      const headingLine = segment.heading ? `Heading: ${segment.heading}\n` : '';
      return `[${segment.id}]\n${headingLine}${segment.text}`;
    })
    .join('\n\n---\n\n');

  return `
Extract only these funding fields:
${LLM_EXTRACTABLE_FUNDING_FIELD_KEYS.map((key) => `- ${key}`).join('\n')}

Return strict JSON only.

Return a JSON object with:
- fields: every listed field must be present
- warnings: array of extraction notes, or []

Field rules:
- status must be one of "supported", "unsupported", or "ambiguous"
- confidence must be between 0 and 1
- evidence must be an array of anchors with:
  - sourceType: "segment"
  - segmentId: one of the ids below
  - quote: exact supporting text from that segment
  - heading: optional heading copied from the segment context
- For array fields, return a flat string array or null
- For numeric fields, return a number or null
- For boolean fields, return a boolean or null
- For date fields, use YYYY-MM-DD when explicitly supported, otherwise null
- For description, return short supported source snippets; do not synthesize a new narrative

Source segments:
${serializedSegments}
`;
}

async function callCoreExtractor(
  prompt: string,
  llmContext?: FundingLlmRoutingContext | null
): Promise<{ model: string; parsed: FundingIntakeStructuredOutput }> {
  const gatewayResponse = await runFundingGatewayExtraction({
    stageCode: FUNDING_CALL_INGEST_TEXT_STAGE_CODE,
    prompt,
    systemPrompt: SYSTEM_INSTRUCTIONS,
    context: llmContext,
    maxTokensOut: 12000,
    temperature: 0,
    promptCacheKey: `funding-intake:core:${FUNDING_INTAKE_PROMPT_VERSION}`,
    promptCacheRetention: '24h',
    metadata: {
      action: 'funding_call_core_extraction',
      promptCacheKey: `funding-intake:core:${FUNDING_INTAKE_PROMPT_VERSION}`,
    },
  });

  if (gatewayResponse) {
    const parsed = parseCoreExtractorPayload(gatewayResponse.rawText);

    return {
      model: gatewayResponse.model,
      parsed,
    };
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const model = process.env.FUNDING_INTAKE_DEEPSEEK_MODEL || 'deepseek-v4-pro';

    try {
      const response = await generateJsonFromDeepSeek({
        prompt,
        model,
        systemPrompt: SYSTEM_INSTRUCTIONS,
        maxTokens: 12000,
        temperature: 0,
      });
      const parsed = parseCoreExtractorPayload(response.rawText);

      return {
        model: response.model,
        parsed,
      };
    } catch (error) {
      if (!process.env.OPENAI_API_KEY) {
        throw error;
      }

      console.warn(
        '[Funding Intake] DeepSeek core extraction failed, falling back to OpenAI:',
        error
      );
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Core funding intake extraction requires DEEPSEEK_API_KEY or OPENAI_API_KEY');
  }

  const model = process.env.FUNDING_INTAKE_OPENAI_MODEL || 'gpt-5.4';
  const response = await parseStructuredFromOpenAI<FundingIntakeStructuredOutput>({
    prompt,
    model,
    systemPrompt: SYSTEM_INSTRUCTIONS,
    schema: fundingIntakeStructuredOutputSchema,
    schemaName: 'funding_intake_core_extraction',
    maxOutputTokens: 6000,
    temperature: 0,
  });

  if (!response.parsed) {
    throw new Error('OpenAI returned no structured funding intake extraction payload');
  }

  return {
    model,
    parsed: response.parsed,
  };
}

function buildRetryPrompt(
  segments: FundingSourceSegment[],
  validationIssues: FundingExtractionValidationIssue[]
): string {
  return `${buildSegmentPrompt(segments)}

The previous extraction failed deterministic validation. Fix these issues exactly:
${validationIssues
  .map((issue, index) => `${index + 1}. ${issue.fieldKey ? `${issue.fieldKey}: ` : ''}${issue.message}`)
  .join('\n')}

Return a corrected payload that satisfies the schema and evidence requirements.`;
}

function assertRetryableValidationState(validationIssues: FundingExtractionValidationIssue[]) {
  const blockingIssues = validationIssues.filter((issue) => issue.retryable);
  if (blockingIssues.length > 0) {
    const error = new Error(
      `Funding extraction failed deterministic validation: ${blockingIssues
        .map((issue) => issue.message)
        .join('; ')}`
    );
    error.name = 'FundingExtractionValidationError';
    throw error;
  }
}

async function runValidatedExtraction(
  segments: FundingSourceSegment[],
  llmContext?: FundingLlmRoutingContext | null
): Promise<{
  payload: FundingExtractionPayload;
  extractorModel: string;
  validationErrors: FundingExtractionValidationIssue[];
}> {
  const prompt = buildSegmentPrompt(segments);
  const firstPass = await callCoreExtractor(prompt, llmContext);
  let payload = normalizeExtractionPayload(firstPass.parsed, { segments });
  let validationErrors = validateFundingExtractionPayload(payload, segments);

  if (validationErrors.some((issue) => issue.retryable)) {
    const retry = await callCoreExtractor(buildRetryPrompt(segments, validationErrors), llmContext);
    payload = normalizeExtractionPayload(retry.parsed, { segments });
    validationErrors = validateFundingExtractionPayload(payload, segments);
  }

  assertRetryableValidationState(validationErrors);

  return {
    payload,
    extractorModel: firstPass.model,
    validationErrors,
  };
}

function buildPdfTextPrompt(): string {
  return `
${PDF_TRANSCRIPTION_SYSTEM_INSTRUCTIONS}

Return JSON in this exact shape:
{
  "rawText": "string",
  "warnings": ["string"]
}
`;
}

function extractGeminiRestText(parsedBody: any, rawBody: string): string {
  const textParts =
    parsedBody?.candidates
      ?.flatMap((candidate: any) => candidate?.content?.parts ?? [])
      ?.filter((part: any) => typeof part?.text === 'string')
      ?.map((part: any) => String(part.text)) ?? [];

  if (textParts.length === 0) {
    throw new Error(`Gemini multimodal request returned no text parts: ${rawBody.slice(0, 1000)}`);
  }

  return textParts.join('');
}

export async function extractCanonicalTextFromPdf(
  storagePath: string,
  llmContext?: FundingLlmRoutingContext | null
): Promise<{
  rawText: string;
  normalizedText: string;
  warnings: string[];
  extractorModel: string;
}> {
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(process.cwd(), storagePath);

  try {
    const fileBuffer = await fs.readFile(absolutePath);
    const pdfParse = (await import('pdf-parse-fork')).default;
    const parsed = await pdfParse(fileBuffer);
    const rawText = String(parsed?.text || '').trim();
    const normalizedText = normalizeMultilineText(rawText);

    if (normalizedText) {
      return {
        rawText,
        normalizedText,
        warnings: [],
        extractorModel: 'pdf-parse-fork',
      };
    }
  } catch (error) {
    console.warn('[Funding Intake] Local PDF text extraction failed, falling back to LLM transcription:', error);
  }

  const pdfFilePart = await buildPdfFileContentPart(storagePath);
  const gatewayResponse = await runFundingGatewayExtraction({
    stageCode: FUNDING_CALL_INGEST_PDF_STAGE_CODE,
    prompt: buildPdfTextPrompt(),
    context: llmContext,
    contentParts: [
      {
        type: 'text',
        text: 'Transcribe this PDF into clean plain text. Use the exact JSON schema from the prompt.',
      },
      pdfFilePart,
    ],
    maxTokensOut: 16000,
    temperature: 0.1,
    promptCacheKey: 'funding-intake:pdf-transcription:v1',
    promptCacheRetention: '24h',
    metadata: {
      action: 'funding_call_pdf_transcription',
      promptCacheKey: 'funding-intake:pdf-transcription:v1',
    },
  });

  if (gatewayResponse) {
    const parsed = parseJsonResponse(gatewayResponse.rawText);
    const rawText = String(parsed?.rawText || '').trim();
    const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.map((warning: unknown) => String(warning)) : [];
    const normalizedText = normalizeMultilineText(rawText);

    if (!normalizedText) {
      throw new Error('PDF transcription returned no usable text');
    }

    return {
      rawText,
      normalizedText,
      warnings,
      extractorModel: gatewayResponse.model,
    };
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    const error = new Error('Gemini multimodal extraction requires GOOGLE_AI_API_KEY');
    error.name = 'pdf_intake_requires_gemini';
    throw error;
  }

  const fileBuffer = await fs.readFile(absolutePath);
  const model = process.env.FUNDING_INTAKE_PDF_GEMINI_MODEL || process.env.FUNDING_INTAKE_GEMINI_MODEL || 'gemini-2.5-pro';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: buildPdfTextPrompt() },
            { text: 'Transcribe this PDF into clean plain text. Use the exact JSON schema from the prompt.' },
            {
              inline_data: {
                data: fileBuffer.toString('base64'),
                mime_type: 'application/pdf',
              },
            },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    }
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini multimodal PDF transcription failed (${response.status} ${response.statusText}): ${rawBody}`);
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    throw new Error(`Gemini multimodal PDF transcription returned non-JSON response: ${(error as Error).message}`);
  }

  const responseText = extractGeminiRestText(parsedBody, rawBody);
  const parsed = parseJsonResponse(responseText);
  const rawText = String(parsed?.rawText || '').trim();
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.map((warning: unknown) => String(warning)) : [];
  const normalizedText = normalizeMultilineText(rawText);

  if (!normalizedText) {
    throw new Error('PDF transcription returned no usable text');
  }

  return {
    rawText,
    normalizedText,
    warnings,
    extractorModel: model,
  };
}

export async function extractFundingOpportunity(
  sourceText: string,
  llmContext?: FundingLlmRoutingContext | null
): Promise<{
  payload: FundingExtractionPayload;
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
  validationErrors: FundingExtractionValidationIssue[];
}> {
  const segments = buildFundingSourceSegments(sourceText);
  if (segments.length === 0) {
    throw new Error('Funding extraction requires normalized source text');
  }

  const extraction = await runValidatedExtraction(segments, llmContext);

  return {
    payload: extraction.payload,
    extractorModel: extraction.extractorModel,
    extractorVersion: FUNDING_INTAKE_EXTRACTOR_VERSION,
    promptVersion: FUNDING_INTAKE_PROMPT_VERSION,
    validationErrors: extraction.validationErrors,
  };
}
