/**
 * Grant Diagram Studio — shared visual theme applied by every compiler so all
 * diagrams in a proposal look like one document.
 */

export interface DiagramTheme {
  key: string
  name: string
  fontFamily: string
  background: string
  text: string
  mutedText: string
  grid: string
  gridStrong: string
  /** Per-group / per-dataset series colors (work packages, chart datasets). */
  series: string[]
  /** Lighter fills matching `series` (bars, boxes). */
  seriesFill: string[]
  accent: string
  critical: string
  milestone: string
  headerBand: string
}

export const DIAGRAM_THEMES: Record<string, DiagramTheme> = {
  classic: {
    key: 'classic',
    name: 'Classic',
    fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
    background: '#ffffff',
    text: '#1e293b',
    mutedText: '#64748b',
    grid: '#e2e8f0',
    gridStrong: '#cbd5e1',
    series: ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488'],
    seriesFill: ['#e0e7ff', '#cffafe', '#d1fae5', '#fef3c7', '#fce7f3', '#ede9fe', '#fee2e2', '#ccfbf1'],
    accent: '#4f46e5',
    critical: '#dc2626',
    milestone: '#b45309',
    headerBand: '#f1f5f9',
  },
  formal: {
    key: 'formal',
    name: 'Formal',
    fontFamily: "Georgia, 'Times New Roman', serif",
    background: '#ffffff',
    text: '#111827',
    mutedText: '#4b5563',
    grid: '#e5e7eb',
    gridStrong: '#d1d5db',
    series: ['#1e3a8a', '#155e75', '#14532d', '#78350f', '#581c87', '#7f1d1d', '#1e293b', '#3f6212'],
    seriesFill: ['#dbeafe', '#cffafe', '#dcfce7', '#fef3c7', '#f3e8ff', '#fee2e2', '#e2e8f0', '#ecfccb'],
    accent: '#1e3a8a',
    critical: '#7f1d1d',
    milestone: '#78350f',
    headerBand: '#f3f4f6',
  },
  vibrant: {
    key: 'vibrant',
    name: 'Vibrant',
    fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
    background: '#ffffff',
    text: '#0f172a',
    mutedText: '#475569',
    grid: '#e2e8f0',
    gridStrong: '#cbd5e1',
    series: ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'],
    seriesFill: ['#e0e7ff', '#cffafe', '#d1fae5', '#fef3c7', '#fce7f3', '#ede9fe', '#fee2e2', '#ccfbf1'],
    accent: '#6366f1',
    critical: '#ef4444',
    milestone: '#f59e0b',
    headerBand: '#eef2ff',
  },
  mono: {
    key: 'mono',
    name: 'Print (mono)',
    fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
    background: '#ffffff',
    text: '#111111',
    mutedText: '#555555',
    grid: '#dddddd',
    gridStrong: '#bbbbbb',
    series: ['#111111', '#444444', '#666666', '#888888', '#222222', '#555555', '#777777', '#333333'],
    seriesFill: ['#f2f2f2', '#e8e8e8', '#dedede', '#d4d4d4', '#ececec', '#e2e2e2', '#d8d8d8', '#efefef'],
    accent: '#111111',
    critical: '#111111',
    milestone: '#111111',
    headerBand: '#f5f5f5',
  },
}

export const DEFAULT_THEME_KEY = 'classic'

export function resolveDiagramTheme(themeKey?: string | null): DiagramTheme {
  if (themeKey && DIAGRAM_THEMES[themeKey]) {
    return DIAGRAM_THEMES[themeKey]
  }
  return DIAGRAM_THEMES[DEFAULT_THEME_KEY]
}

export function seriesColor(theme: DiagramTheme, index: number): string {
  return theme.series[index % theme.series.length]
}

export function seriesFillColor(theme: DiagramTheme, index: number): string {
  return theme.seriesFill[index % theme.seriesFill.length]
}

/** Compact palette description injected into freeform-code prompts. */
export function describeThemeForPrompt(theme: DiagramTheme): string {
  return [
    `background ${theme.background}`,
    `text ${theme.text}`,
    `muted/edges ${theme.mutedText}`,
    `cluster fill ${theme.headerBand} with border ${theme.gridStrong}`,
    `node fills ${theme.seriesFill.slice(0, 5).join(' ')}`,
    `node borders ${theme.series.slice(0, 5).join(' ')}`,
    `font "${theme.fontFamily.split(',')[0].replace(/['"]/g, '').trim()}"`,
  ].join('; ')
}
