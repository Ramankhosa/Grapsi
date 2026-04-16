import type { ResearchIntentLock } from './research-intent-lock-service';

export type RhetoricalCitationMode = 'optional' | 'none' | 'required';

export interface RhetoricalCitationPolicy {
  mode: RhetoricalCitationMode;
  maxCitations: number;
}

export interface RhetoricalSlot {
  key: string;
  required: boolean;
  placement: string;
  intent: string;
  constraints: string[];
  citationPolicy: RhetoricalCitationPolicy;
}

export interface RhetoricalBlueprint {
  enabled: boolean;
  slots: RhetoricalSlot[];
}

const DEFAULT_CITATION_POLICY: RhetoricalCitationPolicy = {
  mode: 'optional',
  maxCitations: 2,
};

const DEFAULTS_BY_SECTION: Record<string, RhetoricalSlot[]> = {
  introduction: [
    {
      key: 'ContextBackground',
      required: true,
      placement: 'start',
      intent: 'Introduce domain context and establish background.',
      constraints: ['No novelty claims', 'Keep 1-2 paragraphs max'],
      citationPolicy: { mode: 'optional', maxCitations: 2 },
    },
    {
      key: 'GapResearchQuestion',
      required: true,
      placement: 'end',
      intent: 'State the gap and research question clearly near section close.',
      constraints: ['Ground the gap in thematic evidence', 'Avoid solution details'],
      citationPolicy: { mode: 'optional', maxCitations: 2 },
    },
    {
      key: 'Contributions',
      required: true,
      placement: 'final',
      intent: 'Provide the contribution list as the final paragraph.',
      constraints: ['Must match ResearchIntentLock contributions exactly', 'No new claims'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
    {
      key: 'PaperStructure',
      required: false,
      placement: 'final',
      intent: 'Optionally preview section flow.',
      constraints: ['1 short paragraph max'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
  ],
  literature_review: [
    {
      key: 'ResearchLandscape',
      required: true,
      placement: 'start',
      intent: 'Frame the research landscape at a high level.',
      constraints: ['Use thematic clusters, not paper-by-paper narration'],
      citationPolicy: { mode: 'optional', maxCitations: 2 },
    },
    {
      key: 'ThematicSynthesis',
      required: true,
      placement: 'middle',
      intent: 'Synthesize literature thematically with tension and overlap.',
      constraints: ['Keep claims tied to evidence digest'],
      citationPolicy: { mode: 'optional', maxCitations: 2 },
    },
    {
      key: 'Limitations',
      required: true,
      placement: 'end',
      intent: 'Highlight unresolved limitations in prior work.',
      constraints: ['Do not introduce the paper method yet'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
    {
      key: 'StudyPositioning',
      required: false,
      placement: 'end',
      intent: 'Position the current study relative to the mapped gap.',
      constraints: ['Stay concise'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
  ],
  methodology: [
    {
      key: 'ResearchDesign',
      required: true,
      placement: 'start',
      intent: 'Declare the research design and rationale.',
      constraints: ['Do not report results'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'SystemArchitecture',
      required: true,
      placement: 'middle',
      intent: 'Describe the system/approach architecture.',
      constraints: ['Align terminology with prior sections'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'DataProtocol',
      required: true,
      placement: 'middle',
      intent: 'Detail data sources, preprocessing, and sampling protocol.',
      constraints: ['Report reproducibility-critical settings'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'EvaluationStrategy',
      required: true,
      placement: 'end',
      intent: 'Define evaluation metrics and comparison plan.',
      constraints: ['No outcome claims'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'ImplementationDetails',
      required: false,
      placement: 'end',
      intent: 'Optional implementation details and tooling notes.',
      constraints: ['Keep concise and reproducible'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
  ],
  results: [
    {
      key: 'ExperimentalContext',
      required: true,
      placement: 'start',
      intent: 'State experimental setup context for interpreting outcomes.',
      constraints: ['No method restatement'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'EmpiricalFindings',
      required: true,
      placement: 'middle',
      intent: 'Report empirical findings clearly and directly.',
      constraints: ['Use measured outcomes only'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'ComparativeAnalysis',
      required: true,
      placement: 'end',
      intent: 'Compare findings against baselines or alternatives.',
      constraints: ['Avoid causal overclaims'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'Robustness',
      required: false,
      placement: 'end',
      intent: 'Optional robustness and sensitivity checks.',
      constraints: ['Mention uncertainty where relevant'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
  ],
  discussion: [
    {
      key: 'Interpretation',
      required: true,
      placement: 'start',
      intent: 'Interpret core findings and their meaning.',
      constraints: ['Tie interpretation to reported results'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
    {
      key: 'RelationToLiterature',
      required: true,
      placement: 'middle',
      intent: 'Relate findings to prior literature and disagreements.',
      constraints: ['Use explicit reinforce/contradict/extend framing'],
      citationPolicy: { mode: 'optional', maxCitations: 2 },
    },
    {
      key: 'Implications',
      required: true,
      placement: 'middle',
      intent: 'Explain theoretical/practical implications.',
      constraints: ['Do not introduce unsupported new results'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
    {
      key: 'LimitationsFuture',
      required: true,
      placement: 'end',
      intent: 'Close with limitations and future work.',
      constraints: ['Maintain scope discipline'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
  ],
  conclusion: [
    {
      key: 'SynthesisRecap',
      required: true,
      placement: 'start',
      intent: 'Summarize the key findings and contributions without restating the abstract.',
      constraints: ['No new results or data', 'Tie back to thesis statement'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'ContributionSignificance',
      required: true,
      placement: 'middle',
      intent: 'Articulate the significance of contributions to the field.',
      constraints: ['Must align with ResearchIntentLock contributions', 'No overclaims'],
      citationPolicy: { mode: 'optional', maxCitations: 1 },
    },
    {
      key: 'PracticalImplications',
      required: false,
      placement: 'middle',
      intent: 'State practical or policy implications if applicable.',
      constraints: ['Ground in reported findings only'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'LimitationsAndFutureDirections',
      required: true,
      placement: 'end',
      intent: 'Acknowledge limitations and outline concrete future research directions.',
      constraints: ['Be specific about limitations', 'Future work must be actionable'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'ClosingStatement',
      required: true,
      placement: 'final',
      intent: 'End with a concise closing that reinforces the paper thesis.',
      constraints: ['1-2 sentences max', 'No new claims'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
  ],
  abstract: [
    {
      key: 'BackgroundMotivation',
      required: true,
      placement: 'start',
      intent: 'State the research problem and motivation in 1-2 sentences.',
      constraints: ['Keep to 1-2 sentences', 'No citations'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'ObjectiveScope',
      required: true,
      placement: 'start',
      intent: 'State the research objective and scope.',
      constraints: ['1 sentence', 'Must align with thesis'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'MethodApproach',
      required: true,
      placement: 'middle',
      intent: 'Briefly describe the methodology or approach.',
      constraints: ['1-2 sentences', 'Key method only'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'KeyFindings',
      required: true,
      placement: 'middle',
      intent: 'State the principal results or findings.',
      constraints: ['Be specific', 'Include key metrics if applicable'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
    {
      key: 'SignificanceImplication',
      required: true,
      placement: 'end',
      intent: 'Close with the significance or broader implications.',
      constraints: ['1-2 sentences', 'No overclaims'],
      citationPolicy: { mode: 'none', maxCitations: 0 },
    },
  ],
};

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function cloneSlot(slot: RhetoricalSlot): RhetoricalSlot {
  return {
    key: slot.key,
    required: Boolean(slot.required),
    placement: slot.placement,
    intent: slot.intent,
    constraints: [...(slot.constraints || [])],
    citationPolicy: {
      mode: slot.citationPolicy?.mode || DEFAULT_CITATION_POLICY.mode,
      maxCitations: typeof slot.citationPolicy?.maxCitations === 'number'
        ? slot.citationPolicy.maxCitations
        : DEFAULT_CITATION_POLICY.maxCitations,
    },
  };
}

function toSectionTemplateKey(sectionKey: string): string {
  const normalized = normalizeSectionKey(sectionKey);
  if (normalized === 'related_work') return 'literature_review';
  return normalized;
}

function normalizeCitationPolicy(value: unknown): RhetoricalCitationPolicy {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const modeCandidate = String(raw.mode || '').trim().toLowerCase();
  const mode: RhetoricalCitationMode = (
    modeCandidate === 'required'
    || modeCandidate === 'none'
    || modeCandidate === 'optional'
  )
    ? modeCandidate
    : DEFAULT_CITATION_POLICY.mode;

  const rawMax = Number(raw.maxCitations);
  const maxCitations = Number.isFinite(rawMax)
    ? Math.max(0, Math.min(2, Math.round(rawMax)))
    : DEFAULT_CITATION_POLICY.maxCitations;

  return { mode, maxCitations };
}

function normalizeSlot(slot: unknown, fallbackIndex: number): RhetoricalSlot {
  const raw = slot && typeof slot === 'object' && !Array.isArray(slot)
    ? slot as Record<string, unknown>
    : {};

  const key = String(raw.key || `Slot${fallbackIndex + 1}`).trim() || `Slot${fallbackIndex + 1}`;
  const intent = String(raw.intent || '').trim() || 'Provide the expected rhetorical move for this section.';
  const placement = String(raw.placement || '').trim() || 'middle';
  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return {
    key,
    required: raw.required === undefined ? true : Boolean(raw.required),
    placement,
    intent,
    constraints,
    citationPolicy: normalizeCitationPolicy(raw.citationPolicy),
  };
}

export function getDefaultRhetoricalBlueprint(sectionKey: string): RhetoricalBlueprint {
  const templateKey = toSectionTemplateKey(sectionKey);
  const slots = DEFAULTS_BY_SECTION[templateKey] || [];
  return {
    enabled: slots.length > 0,
    slots: slots.map(cloneSlot),
  };
}

export function normalizeRhetoricalBlueprint(
  sectionKey: string,
  value: unknown
): RhetoricalBlueprint {
  const defaults = getDefaultRhetoricalBlueprint(sectionKey);
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const enabled = raw.enabled === undefined ? defaults.enabled : Boolean(raw.enabled);

  const rawSlots = Array.isArray(raw.slots)
    ? raw.slots
    : defaults.slots;

  const slots = rawSlots
    .map((slot, index) => normalizeSlot(slot, index))
    .filter((slot) => Boolean(slot.key));

  return {
    enabled,
    slots: slots.length > 0 ? slots : defaults.slots,
  };
}

export function buildRhetoricalPromptBlock(params: {
  sectionKey: string;
  rhetoricalBlueprint: RhetoricalBlueprint | null | undefined;
  researchIntentLock?: ResearchIntentLock | null;
  fallbackContributions?: string[];
}): string {
  const rhetorical = params.rhetoricalBlueprint;
  if (!rhetorical?.enabled || !Array.isArray(rhetorical.slots) || rhetorical.slots.length === 0) {
    return '';
  }

  const compactSlots = rhetorical.slots.map((slot, index) => ({
    order: index + 1,
    key: slot.key,
    required: slot.required,
    placement: slot.placement,
    intent: slot.intent,
    constraints: slot.constraints,
    citationPolicy: slot.citationPolicy,
  }));

  const lockContributions = Array.isArray(params.researchIntentLock?.contributions)
    ? params.researchIntentLock!.contributions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const lockThesis = String(params.researchIntentLock?.thesisStatement || '').trim();
  const fallbackContributions = Array.isArray(params.fallbackContributions)
    ? params.fallbackContributions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const contributions = lockContributions.length > 0 ? lockContributions : fallbackContributions;

  return `
[PRIORITY 2.65 - RHETORICAL BLUEPRINT] ARGUMENT-STRUCTURE SLOTS (prompt-level only)
Section: ${params.sectionKey}
Slots JSON:
${JSON.stringify(compactSlots, null, 2)}

ResearchIntentLock:
Thesis: ${lockThesis || '(not specified)'}
Allowed contributions:
${contributions.length > 0 ? contributions.map((entry, index) => `${index + 1}. ${entry}`).join('\n') : '(no locked contributions available)'}

Rhetorical rules:
1. Follow slot order/placement for paragraph intents.
2. Keep thematic grounding tied to EvidenceDigest/thematic dimensions only.
3. Never introduce contributions outside ResearchIntentLock.
4. Rhetorical slots are citation-optional per slot policy; do not force coverage.
`;
}

export function getRhetoricalDefaultsCatalog(): Record<string, RhetoricalBlueprint> {
  const keys = Object.keys(DEFAULTS_BY_SECTION);
  const entries = keys.map((key) => [key, getDefaultRhetoricalBlueprint(key)]);
  return Object.fromEntries(entries);
}
