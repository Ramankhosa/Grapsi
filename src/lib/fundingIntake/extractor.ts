import fs from 'fs/promises';
import path from 'path';
import { generateFromGemini } from '../geminiService';
import { generateFromOpenAI } from '../openaiService';
import { FUNDING_INTAKE_EXTRACTOR_VERSION, FUNDING_INTAKE_PROMPT_VERSION } from './constants';
import type { FundingExtractionPayload } from './types';
import { normalizeExtractionPayload, normalizeMultilineText, parseJsonResponse } from './utils';

const SYSTEM_INSTRUCTIONS = `
You extract funding opportunity details from source text.
Only capture facts explicitly supported by the source.
If a field is unsupported, set value to null and is_missing to true.
Do not infer missing grant types, deadlines, geography, countries, or eligibility.
If explicit phrases like "fellowship", "research grant", "travel grant", or "infrastructure" appear, preserve them in funding_kinds.
Scalar fields must be plain strings, numbers, booleans, or null. Never return nested objects for scalar fields.
Array fields must be plain arrays of strings, never arrays of objects.
If the title or description explicitly names the research theme or problem area, include those topical phrases in disciplines.
Return strict JSON only.
`;

const PDF_TRANSCRIPTION_SYSTEM_INSTRUCTIONS = `
You transcribe funding call source documents into clean plain text.
Do not summarize or omit sections.
Preserve the reading order of the document.
Keep headings, bullet points, tables, deadlines, URLs, and eligibility text whenever they are visible.
Return strict JSON only.
`;

function buildPrompt(sourceText: string): string {
  return `
${SYSTEM_INSTRUCTIONS}

Return JSON in this exact shape:
{
  "fields": {
    "agency_name": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "scheme_title": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "description": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "open_date": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "close_date": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "is_rolling": { "value": boolean|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "geography_scope": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "eligible_countries": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "eligible_regions": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "host_countries": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "funder_country": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "funding_kinds": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "institution_types": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "career_stages": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "citizenship_requirements": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "residency_requirements": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "application_languages": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "disciplines": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "amount_min": { "value": number|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "amount_max": { "value": number|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "currency": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "project_duration_min_months": { "value": number|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "project_duration_max_months": { "value": number|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "project_duration_text": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "eligibility_text": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "expected_deliverables_text": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "official_urls": { "value": string[]|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "contact_info": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean },
    "sponsor_type": { "value": string|null, "confidence": number, "evidence": string|null, "is_missing": boolean, "is_uncertain": boolean }
  },
  "warnings": string[]
}

Source text:
${sourceText.slice(0, 60000)}
`;
}

async function callExtractor(prompt: string): Promise<{ model: string; rawText: string }> {
  if (process.env.GOOGLE_AI_API_KEY) {
    const rawText = await generateFromGemini(prompt, process.env.FUNDING_INTAKE_GEMINI_MODEL || 'gemini-2.0-flash');
    return {
      model: process.env.FUNDING_INTAKE_GEMINI_MODEL || 'gemini-2.0-flash',
      rawText,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const rawText = await generateFromOpenAI(
      prompt,
      process.env.FUNDING_INTAKE_OPENAI_MODEL || 'gpt-4o-mini',
      SYSTEM_INSTRUCTIONS
    );
    return {
      model: process.env.FUNDING_INTAKE_OPENAI_MODEL || 'gpt-4o-mini',
      rawText,
    };
  }

  throw new Error('No LLM provider configured for funding intake extraction');
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

export async function extractCanonicalTextFromPdf(storagePath: string): Promise<{
  rawText: string;
  normalizedText: string;
  warnings: string[];
  extractorModel: string;
}> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    const error = new Error('Gemini multimodal extraction requires GOOGLE_AI_API_KEY');
    error.name = 'pdf_intake_requires_gemini';
    throw error;
  }

  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(process.cwd(), storagePath);
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

export async function extractFundingOpportunity(sourceText: string): Promise<{
  payload: FundingExtractionPayload;
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
}> {
  const prompt = buildPrompt(sourceText);
  const { model, rawText } = await callExtractor(prompt);
  const parsed = parseJsonResponse(rawText);
  const payload = normalizeExtractionPayload(parsed);

  return {
    payload,
    extractorModel: model,
    extractorVersion: FUNDING_INTAKE_EXTRACTOR_VERSION,
    promptVersion: FUNDING_INTAKE_PROMPT_VERSION,
  };
}
