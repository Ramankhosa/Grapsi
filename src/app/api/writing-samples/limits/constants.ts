// Section-specific word limits - centralized source of truth
// These are relatively generous to accommodate various writing styles
export const SECTION_WORD_LIMITS: Record<string, {
  min: number
  max: number
  recommended: { min: number; max: number }
  description?: string
}> = {
  title: {
    min: 3,
    max: 50,
    recommended: { min: 5, max: 30 },
    description: 'Brief title for the invention'
  },
  fieldOfInvention: {
    min: 5,
    max: 200,
    recommended: { min: 10, max: 100 },
    description: 'Technical field of the invention'
  },
  background: {
    min: 10,
    max: 1500,
    recommended: { min: 80, max: 400 },
    description: 'Prior art and technical background - include prior art discussion patterns'
  },
  objectsOfInvention: {
    min: 5,
    max: 500,
    recommended: { min: 20, max: 200 },
    description: 'Objects/goals of the invention'
  },
  summary: {
    min: 10,
    max: 1500,
    recommended: { min: 80, max: 400 },
    description: 'Summary of the invention - include structural patterns'
  },
  briefDescriptionOfDrawings: {
    min: 5,
    max: 500,
    recommended: { min: 20, max: 150 },
    description: 'Figure captions and descriptions'
  },
  detailedDescription: {
    min: 20,
    max: 3000,
    recommended: { min: 150, max: 800 },
    description: 'Detailed embodiment descriptions - longer samples capture more writing patterns'
  },
  claims: {
    min: 10,
    max: 2000,
    recommended: { min: 100, max: 600 },
    description: 'Claim structure and phrasing - include multiple claim types for better learning'
  },
  abstract: {
    min: 10,
    max: 500,
    recommended: { min: 50, max: 200 },
    description: 'Abstract summary'
  },
  technicalProblem: {
    min: 10,
    max: 500,
    recommended: { min: 30, max: 200 },
    description: 'Technical problem statement'
  },
  technicalSolution: {
    min: 10,
    max: 500,
    recommended: { min: 30, max: 200 },
    description: 'Technical solution description'
  },
  advantageousEffects: {
    min: 10,
    max: 500,
    recommended: { min: 30, max: 200 },
    description: 'Advantages and effects'
  },
  industrialApplicability: {
    min: 5,
    max: 300,
    recommended: { min: 20, max: 150 },
    description: 'Industrial application'
  },
  bestMethod: {
    min: 10,
    max: 1000,
    recommended: { min: 50, max: 300 },
    description: 'Best mode of carrying out invention'
  },
  preamble: {
    min: 5,
    max: 200,
    recommended: { min: 10, max: 100 },
    description: 'Claim preamble style'
  },
  crossReference: {
    min: 5,
    max: 300,
    recommended: { min: 10, max: 100 },
    description: 'Cross-reference format'
  }
}

export const DEFAULT_LIMITS = {
  min: 5,
  max: 1000,
  recommended: { min: 10, max: 300 },
  description: 'Generic section'
}

export const MAX_CHARS = 10000
