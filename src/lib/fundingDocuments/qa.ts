// @ts-nocheck
import prisma from '@/lib/prisma';
import { FUNDING_CHAT_TASK_CODE, runFundingGatewayText } from '@/lib/funding/llmRouting';
import {
  FUNDING_DOC_QA_STAGE_CODE,
  classifyQuestionCategoryHeuristic,
  isFundingDocumentSectionType,
  sectionTypesForQuestionCategory,
  type FundingDocumentQuestionCategory,
} from './constants';
import { fundingDocumentRetrievalService } from './retrieval';
import type { FundingDocumentQaRequest, FundingDocumentQaResponse, FundingDocumentSearchResult } from './types';

function extractJsonObject(raw: string) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {};
}

async function classifyQuestion(question: string, context: FundingDocumentQaRequest['llmContext']) {
  const heuristic = classifyQuestionCategoryHeuristic(question);
  if (heuristic !== 'general') {
    return heuristic;
  }

  try {
    const response = await runFundingGatewayText({
      taskCode: FUNDING_CHAT_TASK_CODE,
      stageCode: FUNDING_DOC_QA_STAGE_CODE,
      prompt: `Classify this funding-call question into exactly one category:
eligibility, budget, dates, documents, thematic, process, contact, general

Return JSON only: {"category":"..."}.

Question: ${question}`,
      context,
      responseMimeType: 'application/json',
      temperature: 0,
      maxTokensOut: 300,
      metadata: {
        purpose: 'funding_document_qa_classification',
      },
    });
    const parsed = extractJsonObject(response?.rawText || '');
    const category = String(parsed.category || '');
    if (['eligibility', 'budget', 'dates', 'documents', 'thematic', 'process', 'contact', 'general'].includes(category)) {
      return category as FundingDocumentQuestionCategory;
    }
  } catch {
    // Heuristic fallback is good enough when classification fails.
  }

  return heuristic;
}

function formatStructuredContext(call: any) {
  const lines = [
    call.scheme_title ? `Scheme title: ${call.scheme_title}` : '',
    call.agency_name ? `Agency: ${call.agency_name}` : '',
    call.open_date ? `Structured open date: ${call.open_date.toISOString().slice(0, 10)}` : '',
    call.close_date ? `Structured close date: ${call.close_date.toISOString().slice(0, 10)}` : '',
    call.is_rolling ? 'Structured deadline: rolling opportunity' : '',
    call.amount_min || call.amount_max
      ? `Structured funding amount: ${[call.amount_min, call.amount_max].filter((value) => value !== null && value !== undefined).join(' - ')} ${call.currency || ''}`.trim()
      : '',
    call.eligibility_text ? `Structured eligibility: ${call.eligibility_text}` : '',
    call.geography_scope ? `Structured geography scope: ${call.geography_scope}` : '',
    call.eligible_countries?.length ? `Structured eligible countries: ${call.eligible_countries.join(', ')}` : '',
    call.host_countries?.length ? `Structured host countries: ${call.host_countries.join(', ')}` : '',
    call.institution_types?.length ? `Structured institution types: ${call.institution_types.join(', ')}` : '',
    call.career_stages?.length ? `Structured career stages: ${call.career_stages.join(', ')}` : '',
    call.application_languages?.length ? `Structured application languages: ${call.application_languages.join(', ')}` : '',
    call.contact_info ? `Structured contact: ${call.contact_info}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

function formatEvidence(chunks: FundingDocumentSearchResult[]) {
  return chunks.map((chunk, index) => ({
    id: index + 1,
    sectionTitle: chunk.sectionTitle,
    sectionType: chunk.sectionType,
    pages: chunk.pageStart === 0 ? 'section' : `${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ''}`,
    documentVersion: chunk.documentVersion,
    text: chunk.chunkText.slice(0, 1800),
  }));
}

function citationsFromChunks(chunks: FundingDocumentSearchResult[]) {
  const seen = new Set<string>();
  return chunks
    .filter((chunk) => {
      const key = `${chunk.sectionTitle || ''}:${chunk.sectionType}:${chunk.pageStart}:${chunk.pageEnd}:${chunk.documentVersion}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((chunk) => ({
      sectionTitle: chunk.sectionTitle,
      sectionType: chunk.sectionType,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      documentVersion: chunk.documentVersion,
    }));
}

export class FundingDocumentQaService {
  async answerQuestion(request: FundingDocumentQaRequest): Promise<FundingDocumentQaResponse> {
    const question = String(request.question || '').trim();
    if (!question) {
      throw new Error('Question is required');
    }

    const call = await prisma.fundingCall.findUnique({
      where: { id: request.callId },
      select: {
        id: true,
        scheme_title: true,
        agency_name: true,
        open_date: true,
        close_date: true,
        is_rolling: true,
        amount_min: true,
        amount_max: true,
        currency: true,
        eligibility_text: true,
        geography_scope: true,
        eligible_countries: true,
        host_countries: true,
        institution_types: true,
        career_stages: true,
        application_languages: true,
        contact_info: true,
      },
    });

    if (!call) {
      throw new Error('Funding call not found');
    }

    const category = await classifyQuestion(question, request.llmContext);
    const routedSections = sectionTypesForQuestionCategory(category).filter(isFundingDocumentSectionType);
    let chunks = await fundingDocumentRetrievalService.searchChunks({
      query: question,
      fundingCallId: request.callId,
      sectionTypes: routedSections,
      callStatus: 'any',
      topK: 6,
      minSimilarity: 0.25,
      access: request.access,
      llmContext: request.llmContext,
    });

    if (chunks.length < 2) {
      const widened = await fundingDocumentRetrievalService.searchChunks({
        query: question,
        fundingCallId: request.callId,
        callStatus: 'any',
        topK: 6,
        minSimilarity: 0.22,
        access: request.access,
        llmContext: request.llmContext,
      });
      const byId = new Map([...chunks, ...widened].map((chunk) => [chunk.chunkId, chunk]));
      chunks = Array.from(byId.values()).sort((left, right) => right.similarity - left.similarity).slice(0, 6);
    }

    const structuredContext = formatStructuredContext(call);
    if (chunks.length === 0) {
      return {
        answer: structuredContext
          ? `I could not find relevant evidence in the uploaded call document. Structured catalog fields may help, but manual review is recommended.\n\n${structuredContext}`
          : 'I could not find this in the uploaded call document. Manual review is recommended.',
        citations: [],
        answeredFrom: structuredContext ? 'structured' : 'not_found',
        category,
      };
    }

    try {
      const evidence = formatEvidence(chunks);
      const response = await runFundingGatewayText({
        taskCode: FUNDING_CHAT_TASK_CODE,
        stageCode: FUNDING_DOC_QA_STAGE_CODE,
        prompt: `Answer the user's funding-call question using only the authoritative structured fields and the supplied document evidence.

Rules:
- Treat structured fields as authoritative for status, dates, and catalog metadata.
- Treat document evidence as supporting evidence only.
- Cite document claims inline as [section type, page(s), vN].
- If the evidence is incomplete, say manual review is recommended.
- Do not infer a final eligibility decision unless the evidence directly supports it.

Question:
${question}

Structured fields:
${structuredContext || 'No structured fields available.'}

Document evidence:
${JSON.stringify(evidence, null, 2)}

Return JSON only:
{
  "answer": "concise grounded answer",
  "answeredFrom": "structured" | "document" | "both" | "not_found"
}`,
        context: request.llmContext,
        responseMimeType: 'application/json',
        temperature: 0,
        maxTokensOut: 1600,
        metadata: {
          purpose: 'funding_document_qa_answer',
          category,
          evidenceCount: chunks.length,
        },
      });

      const parsed = extractJsonObject(response?.rawText || '');
      const answeredFrom = ['structured', 'document', 'both', 'not_found'].includes(parsed.answeredFrom)
        ? parsed.answeredFrom
        : structuredContext
          ? 'both'
          : 'document';

      return {
        answer: String(parsed.answer || '').trim() || 'The document evidence was found, but no grounded answer could be generated. Manual review is recommended.',
        citations: citationsFromChunks(chunks),
        answeredFrom,
        category,
      };
    } catch (error) {
      const top = chunks[0];
      return {
        answer: `Relevant document evidence was found in ${top.sectionTitle || top.sectionType}${top.pageStart ? `, page ${top.pageStart}` : ''}, but the answer generator failed. Manual review is recommended.`,
        citations: citationsFromChunks(chunks.slice(0, 3)),
        answeredFrom: 'document',
        category,
      };
    }
  }
}

export const fundingDocumentQaService = new FundingDocumentQaService();
