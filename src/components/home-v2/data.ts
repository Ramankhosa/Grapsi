export const pipelineSteps = [
  {
    eyebrow: '01 · PROFILE',
    title: 'Your research, understood.',
    body: 'Publications, prior grants, and expertise become a live profile the engine can match against.',
  },
  {
    eyebrow: '02 · DISCOVERY',
    title: 'Every open call, ranked for you.',
    body: 'Alignment scoring against eligibility, priorities, and deadlines, not keyword search.',
  },
  {
    eyebrow: '03 · PRECEDENT',
    title: 'See what actually won.',
    body: 'Your idea is placed among previously funded projects to reveal what agencies rewarded.',
  },
  {
    eyebrow: '04 · POSITIONING',
    title: 'Claim the white space.',
    body: 'Gap analysis across funded projects, patents, and publications finds the angle that is both novel and fundable.',
  },
  {
    eyebrow: '05 · REFINEMENT',
    title: 'A concept built to the call.',
    body: "Objectives, work packages, and budget logic are assembled around the agency's own evaluation criteria.",
  },
  {
    eyebrow: '06 · REVIEW',
    title: 'Scored before you submit.',
    body: 'An AI panel reviews against guidelines, completeness, impact, and reviewer expectations while you can still fix it.',
  },
]

export const signals = [
  'HORIZON EUROPE · HEALTH-2026-TOOL-11 · closes in 41d',
  'NIH R01 · resubmission window open',
  'NSF CAREER · avg award $580K',
  'DST-SERB CRG · call opened',
  'ERC StG · success rate 14.9%',
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
    title: 'Individual Researchers & Labs',
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

export const graphNodes = [
  { id: 'r1', x: 14, y: 48, kind: 'researcher' },
  { id: 'r2', x: 22, y: 28, kind: 'researcher' },
  { id: 'r3', x: 26, y: 70, kind: 'researcher' },
  { id: 'c1', x: 44, y: 35, kind: 'call' },
  { id: 'c2', x: 50, y: 62, kind: 'call' },
  { id: 'c3', x: 60, y: 22, kind: 'call' },
  { id: 'f1', x: 74, y: 36, kind: 'funded' },
  { id: 'f2', x: 82, y: 54, kind: 'funded' },
  { id: 'f3', x: 69, y: 70, kind: 'funded' },
  { id: 'p1', x: 36, y: 18, kind: 'publication' },
  { id: 'p2', x: 66, y: 48, kind: 'publication' },
  { id: 'p3', x: 88, y: 24, kind: 'publication' },
  { id: 'p4', x: 43, y: 78, kind: 'publication' },
  { id: 'p5', x: 91, y: 73, kind: 'publication' },
] as const

export const graphEdges = [
  ['r1', 'c1'],
  ['r1', 'c2'],
  ['r2', 'c1'],
  ['r3', 'c2'],
  ['c1', 'f1'],
  ['c1', 'f2'],
  ['c2', 'f2'],
  ['c2', 'f3'],
  ['p1', 'c1'],
  ['p2', 'f2'],
  ['p3', 'f1'],
  ['p4', 'c2'],
  ['p5', 'f3'],
] as const
