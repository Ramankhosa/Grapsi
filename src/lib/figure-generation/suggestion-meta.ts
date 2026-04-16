import type { FigureSuggestion } from './types';

export type FigureSuggestionStatus = 'pending' | 'used' | 'dismissed';

export type FigureSuggestionTransportMeta = Partial<Pick<
  FigureSuggestion,
  | 'rendererPreference'
  | 'relevantSection'
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

export function extractFigureSuggestionMeta(
  source?: Partial<FigureSuggestionTransport> | null
): FigureSuggestionTransportMeta | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const meta: FigureSuggestionTransportMeta = {};

  for (const key of FIGURE_SUGGESTION_META_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      (meta as Record<string, unknown>)[key] = value;
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}
