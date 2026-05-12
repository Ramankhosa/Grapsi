import type { FigureSuggestion } from './types';

export type FigureSuggestionStatus = 'pending' | 'used' | 'dismissed';

export type FigureSuggestionTransportMeta = Partial<Pick<
  FigureSuggestion,
  | 'rendererPreference'
  | 'relevantSection'
  | 'sourceSections'
  | 'sourceText'
  | 'focusText'
  | 'sectionLabelEvidence'
  | 'scopeMode'
  | 'figureRole'
  | 'sectionFitJustification'
  | 'expectedByReviewers'
  | 'importance'
  | 'dataNeeded'
  | 'whyThisFigure'
  | 'renderSpec'
  | 'chartSpec'
  | 'diagramSpec'
  | 'illustrationSpec'
  | 'illustrationSpecV2'
  | 'figureGenre'
  | 'renderDirectives'
  | 'paperProfile'
  | 'sketchStyle'
  | 'sketchPrompt'
  | 'sketchMode'
>>;

export type FigureSuggestionTransport = FigureSuggestionTransportMeta & Pick<
  FigureSuggestion,
  'title' | 'description' | 'category' | 'importance'
> & {
  suggestedType?: FigureSuggestion['suggestedType'];
  id?: string;
  status?: FigureSuggestionStatus;
  usedByFigureId?: string | null;
  usedAt?: string | null;
};

const FIGURE_SUGGESTION_META_KEYS: Array<keyof FigureSuggestionTransportMeta> = [
  'rendererPreference',
  'relevantSection',
  'sourceSections',
  'sourceText',
  'focusText',
  'sectionLabelEvidence',
  'scopeMode',
  'figureRole',
  'sectionFitJustification',
  'expectedByReviewers',
  'importance',
  'dataNeeded',
  'whyThisFigure',
  'renderSpec',
  'chartSpec',
  'diagramSpec',
  'illustrationSpec',
  'illustrationSpecV2',
  'figureGenre',
  'renderDirectives',
  'paperProfile',
  'sketchStyle',
  'sketchPrompt',
  'sketchMode'
];

const VALID_SKETCH_STYLES = new Set(['academic', 'scientific', 'conceptual', 'technical']);
const VALID_SKETCH_MODES = new Set(['SUGGEST', 'GUIDED']);
const VALID_FIGURE_GENRES = new Set([
  'METHOD_BLOCK',
  'SCENARIO_STORYBOARD',
  'CONCEPTUAL_FRAMEWORK',
  'GRAPHICAL_ABSTRACT',
  'NEURAL_ARCHITECTURE',
  'EXPERIMENTAL_SETUP',
  'DATA_PIPELINE',
  'COMPARISON_MATRIX',
  'PROCESS_MECHANISM',
  'SYSTEM_INTERACTION'
]);
const ILLUSTRATION_ONLY_META_KEYS = new Set<keyof FigureSuggestionTransportMeta>([
  'illustrationSpec',
  'illustrationSpecV2',
  'figureGenre',
  'renderDirectives',
  'sketchStyle',
  'sketchPrompt',
  'sketchMode'
]);

function isIllustrationSuggestion(source: Partial<FigureSuggestionTransport>): boolean {
  const category = String(source.category || '').toUpperCase();
  const suggestedType = String(source.suggestedType || '').toLowerCase();
  return category === 'ILLUSTRATED_FIGURE'
    || category === 'ILLUSTRATION'
    || category === 'SKETCH'
    || suggestedType.startsWith('sketch');
}

export function extractFigureSuggestionMeta(
  source?: Partial<FigureSuggestionTransport> | null
): FigureSuggestionTransportMeta | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const meta: FigureSuggestionTransportMeta = {};
  const keepIllustrationMeta = isIllustrationSuggestion(source);

  for (const key of FIGURE_SUGGESTION_META_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      if (!keepIllustrationMeta && ILLUSTRATION_ONLY_META_KEYS.has(key)) {
        continue;
      }
      if (key === 'figureGenre' && !VALID_FIGURE_GENRES.has(String(value))) {
        continue;
      }
      if (key === 'sketchStyle' && !VALID_SKETCH_STYLES.has(String(value))) {
        continue;
      }
      if (key === 'sketchMode' && !VALID_SKETCH_MODES.has(String(value))) {
        continue;
      }
      (meta as Record<string, unknown>)[key] = value;
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}
