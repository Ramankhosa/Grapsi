export type FigureStylePreset =
  | 'auto'
  | 'ieee_clean'
  | 'nature_minimal'
  | 'industrial_dashboard'
  | 'technical_blueprint'
  | 'conceptual_storyboard'

export type FigureOutputMix =
  | 'auto'
  | 'balanced'
  | 'charts_first'
  | 'diagrams_first'
  | 'include_sketches'

export type FigureDetailLevel = 'auto' | 'simple' | 'moderate' | 'advanced'

export type FigurePreferenceStrictness = 'soft' | 'strict'

export interface FigureSuggestionPreferences {
  stylePreset: FigureStylePreset
  outputMix: FigureOutputMix
  chartPreference: 'auto' | 'bar_line' | 'distribution' | 'correlation' | 'comparative'
  diagramPreference: 'auto' | 'flow' | 'architecture' | 'sequence' | 'conceptual'
  visualTone: 'auto' | 'formal' | 'minimal' | 'high_contrast' | 'presentation_ready'
  colorMode: 'auto' | 'color' | 'grayscale' | 'colorblind_safe'
  detailLevel: FigureDetailLevel
  annotationDensity: 'auto' | 'light' | 'balanced' | 'detailed'
  targetAudience: 'auto' | 'academic' | 'industry' | 'mixed'
  exportFormat: 'auto' | 'png' | 'svg' | 'pdf'
  strictness: FigurePreferenceStrictness
}

export const DEFAULT_FIGURE_SUGGESTION_PREFERENCES: FigureSuggestionPreferences = {
  stylePreset: 'auto',
  outputMix: 'auto',
  chartPreference: 'auto',
  diagramPreference: 'auto',
  visualTone: 'auto',
  colorMode: 'auto',
  detailLevel: 'auto',
  annotationDensity: 'auto',
  targetAudience: 'auto',
  exportFormat: 'auto',
  strictness: 'soft'
}

export function normalizeFigurePreferences(
  input?: Partial<FigureSuggestionPreferences> | null
): FigureSuggestionPreferences {
  if (!input) {
    return { ...DEFAULT_FIGURE_SUGGESTION_PREFERENCES }
  }

  return {
    stylePreset: input.stylePreset || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.stylePreset,
    outputMix: input.outputMix || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.outputMix,
    chartPreference: input.chartPreference || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.chartPreference,
    diagramPreference: input.diagramPreference || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.diagramPreference,
    visualTone: input.visualTone || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.visualTone,
    colorMode: input.colorMode || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.colorMode,
    detailLevel: input.detailLevel || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.detailLevel,
    annotationDensity: input.annotationDensity || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.annotationDensity,
    targetAudience: input.targetAudience || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.targetAudience,
    exportFormat: input.exportFormat || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.exportFormat,
    strictness: input.strictness || DEFAULT_FIGURE_SUGGESTION_PREFERENCES.strictness
  }
}

export function resolveThemeFromPreferences(
  preferences?: Partial<FigureSuggestionPreferences> | null
): 'academic' | 'nature' | 'ieee' | 'minimal' | 'modern' {
  const preset = preferences?.stylePreset || 'auto'

  if (preset === 'ieee_clean') return 'ieee'
  if (preset === 'nature_minimal') return 'nature'
  if (preset === 'industrial_dashboard') return 'modern'
  if (preset === 'technical_blueprint') return 'academic'
  if (preset === 'conceptual_storyboard') return 'minimal'

  const tone = preferences?.visualTone
  if (tone === 'minimal') return 'minimal'
  if (tone === 'presentation_ready') return 'modern'

  return 'academic'
}

export function resolveSketchStyleFromPreferences(
  preferences?: Partial<FigureSuggestionPreferences> | null
): 'academic' | 'scientific' | 'conceptual' | 'technical' {
  const preset = preferences?.stylePreset || 'auto'
  const diagramPreference = preferences?.diagramPreference || 'auto'

  if (preset === 'technical_blueprint') return 'technical'
  if (preset === 'conceptual_storyboard') return 'conceptual'
  if (diagramPreference === 'architecture') return 'technical'
  if (diagramPreference === 'conceptual') return 'conceptual'
  if (preferences?.targetAudience === 'industry') return 'technical'

  return 'academic'
}
