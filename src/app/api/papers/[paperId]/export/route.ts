import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import { authenticateUser } from '@/lib/auth-middleware';
import { DraftingService } from '@/lib/drafting-service';
import { exportCitationsToBibtex } from '@/lib/export/bibtex-export';
import { parseVenueExportProfile, resolveExportConfigWithSources } from '@/lib/export/export-config-resolver';
import { buildLatexExport, type LatexFormatting } from '@/lib/export/latex-export';
import { buildPaperDocxBuffer, type PaperDocxFormatting } from '@/lib/export/paper-docx-export';
import type { ExportProfile } from '@/lib/export/export-profile-schema';
import { getPaperFigureImageCandidates } from '@/lib/figure-generation/paper-figure-image';
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureSafeDescription,
  getPaperFigureStoredImagePath,
  isPaperFigureUsable,
} from '@/lib/figure-generation/paper-figure-record';
import { prisma } from '@/lib/prisma';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  resolveCitationKeyFromLookup,
  splitCitationKeyList,
} from '@/lib/utils/citation-key-normalization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_FORMATS = new Set(['docx', 'bibtex', 'latex']);
const NUMERIC_ORDER_STYLES = new Set(['IEEE', 'VANCOUVER']);
const CITE_MARKER_REGEX = /\[CITE:([^\]]+)\]/gi;

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      paperType: true,
      citationStyle: true,
      publicationVenue: {
        include: {
          citationStyle: true,
        },
      },
      researchTopic: true,
      figurePlans: true,
      exportProfile: true,
      paperSectionHumanizations: true,
    },
  });
}

async function getPaperDraft(sessionId: string) {
  return prisma.annexureDraft.findFirst({
    where: {
      sessionId,
      jurisdiction: 'PAPER',
    },
    orderBy: { version: 'desc' },
  });
}

function normalizeExtraSections(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, string>;
  return {};
}

function getFallbackStyleCode(session: Awaited<ReturnType<typeof getSessionForUser>>): string {
  return session?.citationStyle?.code
    || session?.publicationVenue?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

function titleize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stripHtml(value: string): string {
  let text = value;
  text = text.replace(/<\s*br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, '\'');
  return text.trim();
}

function normalizeSectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function computeContentFingerprint(content: string): string {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }

  return `${(hash >>> 0).toString(16)}_${normalized.length}`;
}

function buildCanonicalCitationLookup(citations: Array<{ citationKey: string }>): Map<string, string> {
  return buildCitationKeyLookup(citations.map((citation) => citation.citationKey));
}

function extractOrderedCitationKeysFromSections(
  sections: Array<{ key: string; content: string }>,
  canonicalLookup: Map<string, string>,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const content = section.content || '';
    if (!content.trim()) continue;

    CITE_MARKER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = CITE_MARKER_REGEX.exec(content)) !== null) {
      const keys = splitCitationKeyList(match[1] || '');
      for (const key of keys) {
        const canonical = resolveCitationKeyFromLookup(key, canonicalLookup);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        ordered.push(canonical);
      }
    }
  }

  return ordered;
}

function mergeCitationOrder(primaryOrder: string[], fallbackOrder: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const append = (key: string) => {
    const canonical = String(key || '').trim();
    const normalized = citationKeyIdentity(canonical);
    if (!canonical || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(canonical);
  };
  for (const key of primaryOrder) append(key);
  for (const key of fallbackOrder) append(key);
  return merged;
}

function sortCitationsByOrderedKeys<T extends { citationKey: string }>(
  citations: T[],
  orderedCitationKeys: string[],
): T[] {
  const orderLookup = new Map<string, number>();
  orderedCitationKeys.forEach((key, index) => orderLookup.set(key, index));
  return [...citations].sort((left, right) => {
    const leftRank = orderLookup.get(left.citationKey);
    const rightRank = orderLookup.get(right.citationKey);
    const leftValue = typeof leftRank === 'number' ? leftRank : Number.MAX_SAFE_INTEGER;
    const rightValue = typeof rightRank === 'number' ? rightRank : Number.MAX_SAFE_INTEGER;
    if (leftValue !== rightValue) return leftValue - rightValue;
    return left.citationKey.localeCompare(right.citationKey);
  });
}

function buildCitationNumberingMap(orderedCitationKeys: string[]): Record<string, number> {
  return Object.fromEntries(orderedCitationKeys.map((citationKey, index) => [citationKey, index + 1]));
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey,
  };
}

function selectOrderedSectionKeys(
  extraSections: Record<string, string>,
  sectionOrder: string[],
): string[] {
  if (sectionOrder.length === 0) return Object.keys(extraSections);

  const remaining = Object.keys(extraSections).filter((key) => !sectionOrder.includes(key));
  return [...sectionOrder, ...remaining];
}

function buildHumanizedMap(rows: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  for (const row of rows || []) {
    const key = normalizeSectionKey(String(row?.sectionKey || ''));
    if (!key) continue;
    map[key] = row;
  }
  return map;
}

function pickSectionContent(rawContent: string, humanizedRecord: any): string {
  const draftContent = String(rawContent || '');
  const humanizedContent = typeof humanizedRecord?.humanizedContent === 'string'
    ? humanizedRecord.humanizedContent
    : '';

  if (!humanizedContent.trim()) {
    return draftContent;
  }

  const sourceDraftFingerprint = typeof humanizedRecord?.sourceDraftFingerprint === 'string'
    ? humanizedRecord.sourceDraftFingerprint
    : '';

  if (sourceDraftFingerprint && sourceDraftFingerprint !== computeContentFingerprint(draftContent)) {
    return draftContent;
  }

  return humanizedContent;
}

async function resolveStyleCode(
  requestedStyleCode: string,
  fallbackStyleCode: string,
): Promise<string> {
  const preferred = String(requestedStyleCode || '').trim() || fallbackStyleCode;
  const style = await citationStyleService.getCitationStyle(preferred);
  if (style?.code) return style.code;
  return fallbackStyleCode;
}

async function readFigureAsset(rawImagePath: string, figureNo: number): Promise<{
  fileName: string;
  zipPath: string;
  buffer: Buffer;
} | null> {
  const candidates = getPaperFigureImageCandidates(rawImagePath);
  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      const ext = path.extname(candidate) || '.png';
      const fileName = `figure-${String(figureNo).padStart(2, '0')}${ext.toLowerCase()}`;
      return {
        fileName,
        zipPath: `images/${fileName}`,
        buffer,
      };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[PaperExport] Failed to read figure asset ${candidate}:`, error?.message || error);
      }
    }
  }
  return null;
}

function loadZip(): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const req = eval('require') as (name: string) => any;
  return req('adm-zip');
}

function exportProfileToDocxFormatting(config: ExportProfile): PaperDocxFormatting {
  return {
    fontFamily: config.fontFamily,
    fontSizePt: config.fontSizePt,
    lineSpacing: config.lineSpacing,
    marginsCm: {
      top: config.margins.topCm,
      bottom: config.margins.bottomCm,
      left: config.margins.leftCm,
      right: config.margins.rightCm,
    },
    pageSize: config.pageSize,
    columnLayout: config.columnLayout,
    includePageNumbers: config.includePageNumbers,
    pageNumberPosition: config.pageNumberPosition,
    headerContent: config.headerContent,
    footerContent: config.footerContent,
    sectionNumbering: config.sectionNumbering,
  };
}

function exportProfileToLatexFormatting(config: ExportProfile): LatexFormatting {
  return {
    documentClass: config.documentClass,
    documentClassOptions: config.documentClassOptions,
    columnLayout: config.columnLayout,
    latexPackages: config.latexPackages,
    latexPreambleExtra: config.latexPreambleExtra,
    bibliographyStyle: config.bibliographyStyle,
    citationCommand: config.citationCommand,
    includePageNumbers: config.includePageNumbers,
    margins: config.margins,
    lineSpacing: config.lineSpacing,
    fontSizePt: config.fontSizePt,
    pageSize: config.pageSize,
    fontFamily: config.fontFamily,
    sectionNumbering: config.sectionNumbering,
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const format = new URL(request.url).searchParams.get('format')?.toLowerCase() || 'docx';
    if (!SUPPORTED_FORMATS.has(format)) {
      return NextResponse.json({ error: 'Unsupported export format' }, { status: 400 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const draft = await getPaperDraft(sessionId);
    if (!draft) {
      return NextResponse.json({ error: 'No paper draft available for export' }, { status: 400 });
    }

    const extraSections = normalizeExtraSections(draft.extraSections);
    const sectionOrder = Array.isArray(session.paperType?.sectionOrder)
      ? (session.paperType.sectionOrder as string[])
      : [];
    const orderedKeys = selectOrderedSectionKeys(extraSections, sectionOrder);
    const humanizedMap = buildHumanizedMap(session.paperSectionHumanizations || []);

    const exportProfileResolution = resolveExportConfigWithSources(
      session.exportProfile?.llmExtracted as any,
      session.exportProfile?.userOverrides as any,
      parseVenueExportProfile(session.publicationVenue),
    );
    const exportConfig = exportProfileResolution.config;
    const docxFormatting = exportProfileToDocxFormatting(exportConfig);
    const latexFormatting = exportProfileToLatexFormatting(exportConfig);
    const fallbackStyleCode = getFallbackStyleCode(session);
    const styleCode = await resolveStyleCode(exportConfig.citationStyle, fallbackStyleCode);

    const rawSections = orderedKeys
      .filter((key) => {
        const normalized = normalizeSectionKey(String(key || ''));
        return normalized !== 'title' && normalized !== 'references' && normalized !== 'bibliography';
      })
      .map((key) => {
        const normalizedKey = normalizeSectionKey(key);
        const selectedContent = pickSectionContent(extraSections[key] || '', humanizedMap[normalizedKey]);
        return {
          key,
          title: titleize(key),
          content: stripHtml(selectedContent),
        };
      })
      .filter((section) => section.content.trim().length > 0);

    const citations = await citationService.getCitationsForSession(sessionId);
    const canonicalLookup = buildCanonicalCitationLookup(citations);
    const orderedCitationKeys = extractOrderedCitationKeysFromSections(rawSections, canonicalLookup);
    const fallbackUsedKeys = orderedCitationKeys.length === 0
      ? Array.from(new Set(
          rawSections
            .flatMap((section) => DraftingService.extractCitationKeys(section.content))
            .map((key) => resolveCitationKeyFromLookup(String(key || '').trim(), canonicalLookup) || String(key || '').trim())
            .filter(Boolean),
        ))
      : [];
    const usedCitationKeys = orderedCitationKeys.length > 0 ? orderedCitationKeys : fallbackUsedKeys;
    const filteredCitations = usedCitationKeys.length > 0
      ? citations.filter((citation) => usedCitationKeys.includes(citation.citationKey))
      : citations;

    const isNumericOrderStyle = NUMERIC_ORDER_STYLES.has(styleCode.toUpperCase());
    const citationOrdering = mergeCitationOrder(
      orderedCitationKeys,
      filteredCitations.map((citation) => citation.citationKey),
    );
    const citationNumbering = isNumericOrderStyle
      ? buildCitationNumberingMap(citationOrdering)
      : undefined;

    const formattedSections = await Promise.all(
      rawSections.map(async (section) => {
        const processed = await DraftingService.postProcessSection(
          section.content,
          sessionId,
          styleCode,
          { citationNumbering },
        );
        return {
          ...section,
          content: processed.processedContent,
        };
      }),
    );

    const bibliographyCitations = isNumericOrderStyle
      ? sortCitationsByOrderedKeys(filteredCitations, citationOrdering)
      : filteredCitations;
    const bibliography = bibliographyCitations.length > 0
      ? await citationStyleService.generateBibliography(
          bibliographyCitations.map(toCitationData),
          styleCode,
          isNumericOrderStyle ? { sortOrder: 'order_of_appearance' } : undefined,
        )
      : '';

    const title = session.researchTopic?.title || draft.title || 'Untitled Paper';
    const figures = await Promise.all(
      (session.figurePlans || [])
        .slice()
        .sort((left, right) => left.figureNo - right.figureNo)
        .filter((figure) => {
          const nodes = asPaperFigureMeta(figure.nodes);
          return isPaperFigureUsable(nodes, getPaperFigureStoredImagePath(nodes));
        })
        .map(async (figure) => {
          const nodes = asPaperFigureMeta(figure.nodes);
          const rawImagePath = getPaperFigureStoredImagePath(nodes);
          const asset = rawImagePath ? await readFigureAsset(rawImagePath, figure.figureNo) : null;
          const caption = getPaperFigureCaption(nodes, figure.description || '');

          return {
            figureNo: figure.figureNo,
            title: figure.title,
            description: getPaperFigureSafeDescription(nodes, figure.description || ''),
            caption,
            asset,
          };
        }),
    );

    if (format === 'docx') {
      const buffer = await buildPaperDocxBuffer({
        title,
        sections: formattedSections,
        bibliography,
        figures: figures.map((figure) => ({
          figureNo: figure.figureNo,
          title: figure.title,
          caption: figure.caption || figure.description,
          asset: figure.asset || undefined,
        })),
        formatting: docxFormatting,
      });

      return new NextResponse(buffer as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="paper_${sessionId}.docx"`,
        },
      });
    }

    if (format === 'latex') {
      const latexResult = buildLatexExport({
        title,
        sections: rawSections,
        figures: figures.map((figure) => ({
          figureNo: figure.figureNo,
          caption: `${figure.title || `Figure ${figure.figureNo}`}${figure.caption ? ` - ${figure.caption}` : ''}`,
          imagePath: figure.asset?.zipPath || undefined,
        })),
        citations: filteredCitations.map(toCitationData),
        bibliographyStyle: exportConfig.bibliographyStyle,
        formatting: latexFormatting,
      });

      const AdmZip = loadZip();
      const zip = new AdmZip();
      zip.addFile(`paper_${sessionId}.tex`, Buffer.from(latexResult.latex, 'utf8'));
      zip.addFile('references.bib', Buffer.from(latexResult.bibtex || '', 'utf8'));

      for (const figure of figures) {
        if (figure.asset) {
          zip.addFile(figure.asset.zipPath, figure.asset.buffer);
        }
      }

      const archive = zip.toBuffer();
      return new NextResponse(archive as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="paper_${sessionId}_latex.zip"`,
        },
      });
    }

    const bibtex = exportCitationsToBibtex(
      filteredCitations.map((citation) => ({
        ...toCitationData(citation),
        sourceType: citation.sourceType,
      })),
    );

    return new NextResponse(bibtex, {
      headers: {
        'Content-Type': 'text/x-bibtex',
        'Content-Disposition': `attachment; filename="paper_${sessionId}.bib"`,
      },
    });
  } catch (error) {
    console.error('[PaperExport] error:', error);
    return NextResponse.json({ error: 'Failed to export paper' }, { status: 500 });
  }
}
