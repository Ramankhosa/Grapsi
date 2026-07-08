import { buildGuidelineSummary, normalizeGuidelinePack } from '../fundingGuidelines/utils';
import { normalizeGrantTemplate } from '../fundingTemplates/utils';

export type JsonArtifactPreview = {
  guidelineRuleCount: number;
  templateItemCount: number;
  documentUrlCount: number;
  hasGuidelines: boolean;
  hasTemplate: boolean;
  hasDocumentUrls: boolean;
};

const EMPTY_PREVIEW: JsonArtifactPreview = {
  guidelineRuleCount: 0,
  templateItemCount: 0,
  documentUrlCount: 0,
  hasGuidelines: false,
  hasTemplate: false,
  hasDocumentUrls: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Count the guideline rules and template items parsed from a JSON/CSV intake
 * upload and parked on the job's `fetch_metadata_json.json_artifacts` — so the
 * intake UI can tell the admin what will be imported before the draft is saved.
 * Returns zeros for missing or malformed input.
 */
export function summarizeJsonArtifacts(fetchMetadataJson: unknown): JsonArtifactPreview {
  const artifacts = asRecord(asRecord(fetchMetadataJson)?.json_artifacts);
  if (!artifacts) {
    return EMPTY_PREVIEW;
  }

  let guidelineRuleCount = 0;
  if (artifacts.guideline_pack_json) {
    try {
      guidelineRuleCount = buildGuidelineSummary(
        normalizeGuidelinePack(artifacts.guideline_pack_json)
      ).totalRules;
    } catch {
      guidelineRuleCount = 0;
    }
  }

  let templateItemCount = 0;
  if (artifacts.grant_template_json) {
    try {
      const template = normalizeGrantTemplate(artifacts.grant_template_json);
      templateItemCount =
        template.questions.length +
        template.sections.length +
        template.attachments.length +
        template.evaluationCriteria.length +
        template.submissionRules.items.length +
        (template.budget ? 1 : 0);
    } catch {
      templateItemCount = 0;
    }
  }

  const documentUrlCount = Array.isArray(artifacts.document_urls)
    ? artifacts.document_urls.filter((url) => /^https?:\/\/.+/i.test(String(url || ''))).length
    : 0;

  return {
    guidelineRuleCount,
    templateItemCount,
    documentUrlCount,
    hasGuidelines: guidelineRuleCount > 0,
    hasTemplate: templateItemCount > 0,
    hasDocumentUrls: documentUrlCount > 0,
  };
}
