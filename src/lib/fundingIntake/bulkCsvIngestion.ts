import AdmZip from 'adm-zip';

import { parseFundingCsvUpload } from './csvIngestion';
import type { BatchIntakeJobInput } from './types';

/**
 * Outcome for a single CSV file inside the uploaded archive. Every archive entry
 * that looks like a call CSV produces exactly one result, whether it parsed or not,
 * so the UI can show a per-file success/failure list.
 */
export interface BulkCsvEntryResult {
  name: string;
  ok: boolean;
  error?: string;
  agencyName?: string | null;
  schemeTitle?: string | null;
}

export interface BulkCsvExtractionResult {
  /** One batch job (single JSON source) per successfully parsed CSV. */
  jobs: BatchIntakeJobInput[];
  /** Per-file outcomes in archive order (both successes and failures). */
  results: BulkCsvEntryResult[];
  totalCsvFiles: number;
  parsedCount: number;
  failedCount: number;
}

// Archive housekeeping entries a zip tool may add (macOS resource forks, hidden
// dotfiles) are not call CSVs and must be ignored.
function isCallCsvEntry(entryName: string): boolean {
  if (entryName.includes('__MACOSX')) return false;
  const base = entryName.split(/[\\/]/).pop() || entryName;
  if (!base || base.startsWith('.') || base.startsWith('~$')) return false;
  return /\.csv$/i.test(base);
}

/**
 * Read a .zip archive of funding-call CSVs and convert each CSV into the same
 * intake object the single-CSV upload path produces, wrapped as a JSON batch job.
 *
 * Each CSV becomes one intake job (JSON source) with auto-draft + extract-all so
 * the existing queue processes the whole call — details, guideline pack, template,
 * and any document_url — exactly like a single CSV upload, but for the whole zip.
 *
 * A parse failure on one CSV never blocks the rest; it is recorded in `results`.
 */
export function extractCsvIntakesFromZip(
  buffer: Buffer,
  options?: { operatorNotes?: string; autoPublish?: boolean }
): BulkCsvExtractionResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Could not read the uploaded archive. Make sure it is a valid .zip file.');
  }

  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && isCallCsvEntry(entry.entryName))
    // Stable, human-friendly order so the queued jobs and results line up with the files.
    .sort((left, right) => left.entryName.localeCompare(right.entryName));

  const jobs: BatchIntakeJobInput[] = [];
  const results: BulkCsvEntryResult[] = [];

  for (const entry of entries) {
    const name = entry.entryName;
    let csvText: string;
    try {
      csvText = entry.getData().toString('utf8');
    } catch {
      results.push({ name, ok: false, error: 'Could not read file bytes from the archive' });
      continue;
    }

    try {
      const intakeObject = parseFundingCsvUpload(csvText);
      const fields = (intakeObject.call?.fields || {}) as Record<string, unknown>;
      const baseName = name.split(/[\\/]/).pop() || name;

      jobs.push({
        operatorNotes: options?.operatorNotes,
        detailsSourceKey: 'source_1',
        guidelinesSourceKey: 'source_1',
        templateSourceKey: 'source_1',
        autoCreateDraft: true,
        extractAll: true,
        autoPublish: options?.autoPublish === true,
        sources: [
          {
            sourceKey: 'source_1',
            inputType: 'json',
            // The single-CSV path stringifies the same intake object and feeds it
            // to the JSON intake; reuse that contract verbatim here.
            sourceJsonText: JSON.stringify(intakeObject),
            sourceJsonFile: {
              originalName: baseName,
              mimeType: 'text/csv',
              size: Buffer.byteLength(csvText, 'utf8'),
            },
          },
        ],
      });

      results.push({
        name,
        ok: true,
        agencyName: typeof fields.agency_name === 'string' ? fields.agency_name : null,
        schemeTitle: typeof fields.scheme_title === 'string' ? fields.scheme_title : null,
      });
    } catch (error) {
      results.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to parse CSV',
      });
    }
  }

  return {
    jobs,
    results,
    totalCsvFiles: entries.length,
    parsedCount: jobs.length,
    failedCount: results.length - jobs.length,
  };
}
