import { fundingDocumentService } from '../fundingDocuments/service';
import type { IntakeOperator } from './types';
import { fetchBinaryDocumentFromUrl } from './utils';

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function readContentDispositionFilename(contentDisposition: string): string | null {
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition || '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].trim()) || null;
  } catch {
    return match[1].trim() || null;
  }
}

function readUrlFilename(url: URL): string | null {
  const basename = url.pathname.split('/').filter(Boolean).pop() || '';
  if (!basename) return null;
  try {
    return decodeURIComponent(basename) || null;
  } catch {
    return basename || null;
  }
}

// Identify the downloaded bytes as PDF or DOCX. PDF is detected from the file
// header alone; DOCX shares the ZIP magic with other formats, so it also needs
// a .docx / wordprocessingml hint from the filename or content type.
function detectDocumentType(
  bytes: Buffer,
  contentType: string,
  fileNameHint: string
): { mime: string; extension: '.pdf' | '.docx' } {
  if (bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    return { mime: PDF_MIME, extension: '.pdf' };
  }

  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const hasDocxHint =
    fileNameHint.toLowerCase().endsWith('.docx') ||
    contentType.toLowerCase().includes('wordprocessingml');
  if (isZip && hasDocxHint) {
    return { mime: DOCX_MIME, extension: '.docx' };
  }

  if (isZip) {
    throw new Error('URL returned a ZIP archive that does not look like a DOCX file');
  }
  throw new Error(`URL did not return a PDF or DOCX document (content-type: ${contentType || 'unknown'})`);
}

/**
 * Download the funding-call document at `url` (PDF or DOCX) and ingest it via
 * the standard funding-document pipeline, which parses, sectionizes, chunks,
 * and embeds it in the background. Duplicate uploads (same checksum) are a
 * no-op thanks to the pipeline's checksum check.
 */
export async function ingestFundingDocumentFromUrl(
  fundingCallId: string,
  url: string,
  operator: IntakeOperator
): Promise<{ documentId: string; duplicate: boolean; fileName: string }> {
  const { bytes, contentType, contentDisposition, finalUrl } = await fetchBinaryDocumentFromUrl(url);
  if (bytes.length === 0) {
    throw new Error('URL returned an empty file');
  }

  const fileNameHint =
    readContentDispositionFilename(contentDisposition) ||
    readUrlFilename(finalUrl) ||
    '';
  const { mime, extension } = detectDocumentType(bytes, contentType, fileNameHint);

  let fileName = fileNameHint || `funding-call-document${extension}`;
  if (!fileName.toLowerCase().endsWith(extension)) {
    fileName = `${fileName}${extension}`;
  }

  // A minimal File-like object: the document pipeline only reads
  // name/type/size/arrayBuffer.
  const file = {
    name: fileName,
    type: mime,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;

  const result = await fundingDocumentService.uploadDocument({
    fundingCallId,
    file,
    sourceUrl: url,
    operator: {
      userId: operator.userId,
      email: operator.email,
      tenantId: operator.tenantId ?? null,
    },
  });

  return {
    documentId: result.document.id,
    duplicate: Boolean(result.duplicate),
    fileName,
  };
}
