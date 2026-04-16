export type PaperFigureMeta = Record<string, unknown>;

type FigureStatus = 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isSketchLike(meta: PaperFigureMeta): boolean {
  const category = cleanString(meta.category).toUpperCase();
  const figureType = cleanString(meta.figureType).toLowerCase();
  return category === 'SKETCH'
    || category === 'ILLUSTRATED_FIGURE'
    || category === 'ILLUSTRATION'
    || figureType.startsWith('sketch');
}

function getSuggestionCaptionDraft(meta: PaperFigureMeta): string {
  const suggestionMeta = asRecord(meta.suggestionMeta);
  const illustrationSpecV2 = asRecord(suggestionMeta.illustrationSpecV2);
  const illustrationSpec = asRecord(suggestionMeta.illustrationSpec);
  return cleanString(illustrationSpecV2.captionDraft)
    || cleanString(illustrationSpec.captionDraft)
    || cleanString(suggestionMeta.captionDraft);
}

function getInferredSummary(meta: PaperFigureMeta): string {
  const inferredImageMeta = asRecord(meta.inferredImageMeta);
  return cleanString(inferredImageMeta.summary);
}

function getDirectGenerationPrompt(meta: PaperFigureMeta): string {
  return cleanString(meta.generationPrompt)
    || cleanString(meta.userPrompt)
    || cleanString(meta.prompt);
}

function isLikelyPromptLeak(meta: PaperFigureMeta, caption: string, planDescription?: string | null): boolean {
  const normalizedCaption = cleanString(caption);
  const normalizedDescription = cleanString(planDescription);
  if (!normalizedCaption || !normalizedDescription || normalizedCaption !== normalizedDescription) {
    return false;
  }

  const directPrompt = getDirectGenerationPrompt(meta);
  const notes = cleanString(meta.notes);
  return directPrompt === normalizedCaption
    || notes === normalizedCaption
    || isSketchLike(meta);
}

export function asPaperFigureMeta(nodes: unknown): PaperFigureMeta {
  return asRecord(nodes);
}

export function isPaperFigureDeleted(meta: PaperFigureMeta): boolean {
  return meta.isDeleted === true || meta.deleted === true || meta.status === 'DELETED';
}

export function getPaperFigureStoredImagePath(meta: PaperFigureMeta): string {
  return cleanString(meta.imagePath);
}

export function getPaperFigureImageVersion(meta: PaperFigureMeta, imagePath?: string | null): string {
  return cleanString(meta.checksum)
    || cleanString(meta.generatedAt)
    || cleanString(imagePath);
}

export function getPaperFigureStatus(meta: PaperFigureMeta, imagePath?: string | null): FigureStatus {
  const explicit = cleanString(meta.status).toUpperCase();
  if (explicit === 'PLANNED' || explicit === 'GENERATING' || explicit === 'GENERATED' || explicit === 'FAILED') {
    return explicit;
  }

  return cleanString(imagePath) ? 'GENERATED' : 'PLANNED';
}

export function isPaperFigureUsable(meta: PaperFigureMeta, imagePath?: string | null): boolean {
  if (isPaperFigureDeleted(meta)) {
    return false;
  }

  return getPaperFigureStatus(meta, imagePath) === 'GENERATED' && cleanString(imagePath).length > 0;
}

export function getPaperFigureGenerationPrompt(meta: PaperFigureMeta, planDescription?: string | null): string {
  const directPrompt = getDirectGenerationPrompt(meta);
  if (directPrompt) {
    return directPrompt;
  }

  const normalizedDescription = cleanString(planDescription);
  if (isLikelyPromptLeak(meta, normalizedDescription, planDescription)) {
    return normalizedDescription;
  }

  return '';
}

export function getPaperFigureCaption(meta: PaperFigureMeta, planDescription?: string | null): string {
  const explicitCaption = cleanString(meta.caption);
  if (explicitCaption && !isLikelyPromptLeak(meta, explicitCaption, planDescription)) {
    return explicitCaption;
  }

  const suggestedCaption = getSuggestionCaptionDraft(meta);
  if (suggestedCaption) {
    return suggestedCaption;
  }

  const inferredSummary = getInferredSummary(meta);
  if (inferredSummary) {
    return inferredSummary;
  }

  const normalizedDescription = cleanString(planDescription);
  if (
    normalizedDescription
    && !isLikelyPromptLeak(meta, normalizedDescription, planDescription)
    && normalizedDescription !== getDirectGenerationPrompt(meta)
  ) {
    return normalizedDescription;
  }

  return '';
}

export function getPaperFigureSafeDescription(meta: PaperFigureMeta, planDescription?: string | null): string {
  const caption = getPaperFigureCaption(meta, planDescription);
  if (caption) {
    return caption;
  }

  const notes = cleanString(meta.notes);
  const generationPrompt = getPaperFigureGenerationPrompt(meta, planDescription);
  return notes && notes !== generationPrompt ? notes : '';
}

export function getPaperFigureCaptionSeed(meta: PaperFigureMeta): string {
  return getSuggestionCaptionDraft(meta) || getInferredSummary(meta);
}
