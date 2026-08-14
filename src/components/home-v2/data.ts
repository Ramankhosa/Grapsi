export const pipelineSteps = [
  {
    step: '01',
    label: 'Profile',
    title: 'Your research, understood.',
    body: 'Publications, prior grants, and expertise become a live profile the engine can match against.',
  },
  {
    step: '02',
    label: 'Discovery',
    title: 'Every open call, ranked for you.',
    body: 'Alignment scoring against eligibility, priorities, and deadlines — not keyword search.',
  },
  {
    step: '03',
    label: 'Precedent',
    title: 'See what actually won.',
    body: 'Your idea is placed among previously funded projects to reveal what agencies rewarded.',
  },
  {
    step: '04',
    label: 'Positioning',
    title: 'Claim the white space.',
    body: 'Gap analysis across funded projects, patents, and publications finds the angle that is both novel and fundable.',
  },
  {
    step: '05',
    label: 'Refinement',
    title: 'A concept built to the call.',
    body: "Objectives, work packages, and budget logic are assembled around the agency's own evaluation criteria.",
  },
  {
    step: '06',
    label: 'Review',
    title: 'Scored before you submit.',
    body: 'An AI panel reviews against guidelines, completeness, impact, and reviewer expectations while you can still fix it.',
  },
]

export const heroMatches = [
  {
    id: 'HORIZON-CL4-2026-DATA-02',
    programme: 'Horizon Europe',
    title: 'AI systems for adaptive health infrastructure',
    score: 92,
    closes: 'closes in 41d',
  },
  {
    id: 'PAR-25-118',
    programme: 'NIH R01',
    title: 'Clinical decision support at the point of care',
    score: 84,
    closes: 'closes in 66d',
  },
  {
    id: 'NSF-24-593',
    programme: 'NSF CAREER',
    title: 'Trustworthy autonomy in safety-critical systems',
    score: 77,
    closes: 'closes in 12d',
  },
  {
    id: 'CRG-2026',
    programme: 'DST-SERB',
    title: 'Materials informatics for clean energy',
    score: 71,
    closes: 'open',
  },
]

export const heroEligibility = [
  { label: 'Consortium of 3+ partners', state: 'met' as const },
  { label: 'TRL 4–6 at project start', state: 'met' as const },
  { label: 'Open-science data plan', state: 'action' as const },
]

export const heroPrecedents = [
  'GA-101094521 · €1.2M · 2024',
  'GA-101076883 · €870K · 2023',
  'GA-101119044 · €1.5M · 2025',
]

export const platformStats = [
  { value: '2.8M', label: 'funded-project records' },
  { value: '96', label: 'programmes normalized' },
  { value: '14', label: 'source families connected' },
]

export const databaseRows = [
  ['Horizon Europe', 'Climate adaptation analytics', '€1.4M', '2025', '7'],
  ['NIH R01', 'Clinical decision support', '$612K', '2024', '1'],
  ['NSF CAREER', 'Trustworthy autonomy', '$579K', '2025', '1'],
  ['ERC StG', 'Low-energy edge intelligence', '€1.5M', '2023', '3'],
  ['DST-SERB CRG', 'Materials informatics', 'INR 41L', '2025', '2'],
  ['UKRI EPSRC', 'AI for resilient networks', '£890K', '2024', '5'],
]

export const audienceCards = [
  {
    title: 'Research Offices',
    body: 'Run portfolio-level funding scans across every department and see where your institution is leaving money unclaimed.',
  },
  {
    title: 'Researchers & Labs',
    body: 'Turn a profile and a rough direction into ranked calls, funded precedents, and a positioned proposal concept.',
  },
  {
    title: 'Startups & SMEs',
    body: 'Find non-dilutive funding routes and shape technical roadmaps around the evidence agencies already reward.',
  },
  {
    title: 'Grant Consultants',
    body: 'Use funded-project intelligence, gap maps, and AI review to pressure-test more client proposals with less manual search.',
  },
]

/** Funders that have paid for work in the example field, ranked by project count. */
export const fieldFunders = [
  { name: 'Horizon Europe', projects: 142, awarded: '€168M' },
  { name: 'NIH', projects: 86, awarded: '$52M' },
  { name: 'UKRI EPSRC', projects: 54, awarded: '£41M' },
  { name: 'NSF', projects: 31, awarded: '$18M' },
  { name: 'DST-SERB', projects: 17, awarded: '₹38Cr' },
]

export const fieldMatrixYears = ['2021', '2022', '2023', '2024', '2025']

/** Sub-topic × year funded-project counts. The `open` row is the gap the engine found. */
export const fieldMatrixRows = [
  { topic: 'Workflow automation', counts: [28, 34, 41, 39, 44] },
  { topic: 'Decision support', counts: [19, 22, 26, 31, 29] },
  { topic: 'Federated health data', counts: [8, 12, 17, 22, 26] },
  { topic: 'Predictive triage', counts: [6, 9, 11, 14, 12] },
  { topic: 'Explainable triage', counts: [1, 2, 0, 1, 2], open: true },
]
