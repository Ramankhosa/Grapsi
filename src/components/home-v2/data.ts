/**
 * Content for the marketing home page. Everything here is illustrative sample
 * data used to *show* how the product behaves — the page labels it as such
 * wherever a reader could mistake it for a live figure.
 */

/** Coverage claims shown under the hero. */
export const platformStats = [
  { value: '50,000+', label: 'projects funded by Indian government agencies, searchable' },
  { value: '1,000+', label: 'funding agencies and opportunities tracked every year' },
  { value: '49', label: 'research disciplines your profile is mapped to' },
]

/**
 * The spine of the page: what actually goes wrong, and the one part of the
 * product that fixes it. Each `fix` points at a section further down.
 */
export const fundingMistakes = [
  {
    n: '01',
    mistake: 'You applied to the wrong call',
    body: 'The science was strong. The call was funding something adjacent to it, and the panel had no box to put you in.',
    fixLabel: 'Matched calls, ranked',
    fix: 'Your publications are mapped to research areas, and every open call is mapped to the same areas. You get the six that genuinely fit, not two hundred you have to read.',
    href: '#mapping',
  },
  {
    n: '02',
    mistake: 'You missed the deadline entirely',
    body: 'The call that was written for your exact work opened in March and closed in May. Nobody forwarded it to you.',
    fixLabel: 'Same-day alerts',
    fix: 'WhatsApp and email the day a matching call opens, with the fit score, the closing date and the reason it matched.',
    href: '#alerts',
  },
  {
    n: '03',
    mistake: 'You were desk-rejected on eligibility',
    body: 'Years since PhD, ongoing grants as PI, institutional recognition, a missing endorsement letter. Rejected before a scientist read a word.',
    fixLabel: 'Eligibility screened first',
    fix: 'Every rule in the call is checked against your profile and shown as a plain checklist, with the ones you still need to fix.',
    href: '#mapping',
  },
  {
    n: '04',
    mistake: 'You proposed what they had already funded',
    body: 'The agency has paid for that idea forty times — or has never funded anything like it and has no line to fund it from.',
    fixLabel: '50,000 funded projects',
    fix: 'Search what each agency has actually paid for, in your field, by year and by amount. Position your idea in the space they are still buying.',
    href: '#evidence',
  },
  {
    n: '05',
    mistake: 'You could not prove the idea was new',
    body: 'Novelty is scored by every panel — and novel means novel against patents, not only against papers. Someone filed on it in 2022 and you found out at the review.',
    fixLabel: 'Patent search built in',
    fix: 'Search the patent record for prior art on your idea before you commit to it, shortlist the closest hits, and turn the gap you find into the novelty claim your proposal needs.',
    href: '#patents',
  },
  {
    n: '06',
    mistake: 'You wrote it for scientists, not for the rubric',
    body: 'Impact written as scientific interest. Objectives with no deliverable. A budget with equipment no work package uses. All scoreable, all avoidable.',
    fixLabel: 'AI review before you submit',
    fix: 'Your draft is marked against that call’s own criteria and weights, and you get the specific line to fix — while there is still time to fix it.',
    href: '#reviewer',
  },
  {
    n: '07',
    mistake: 'You guessed at the format',
    body: 'Wrong annexures, missing ethics clearance, a budget head that gets proposals returned unopened by that particular agency.',
    fixLabel: 'Templates that have won',
    fix: 'Start from the structure of proposals that this agency has already funded, and sit in a live session with the people who used to review them.',
    href: '#templates',
  },
]

/** The four things that happen after a researcher signs up. */
export const journeySteps = [
  {
    step: '01',
    label: 'You paste your work',
    title: 'Add your papers and research areas.',
    body: 'Paste a Scopus, ORCID or Google Scholar link, or tag a few publications. Four minutes, once.',
    time: '4 minutes',
  },
  {
    step: '02',
    label: 'We map you',
    title: 'Your research is placed on the funding map.',
    body: 'Your work is matched to a 49-discipline catalogue. Every incoming call is placed on the same map, so fit is measured, not guessed.',
    time: 'Automatic',
  },
  {
    step: '03',
    label: 'The call finds you',
    title: 'You hear the day a matching call opens.',
    body: 'WhatsApp and email, with the fit score, the deadline and what it matched on. No dashboard to remember to check.',
    time: 'Same day',
  },
  {
    step: '04',
    label: 'You get reviewed',
    title: 'Your draft is scored before the agency sees it.',
    body: 'The AI reviewer marks it against the call’s rubric, and the templates show you how funded proposals were structured.',
    time: '~10 minutes',
  },
]

/** Hero: what a matched-calls list actually looks like. */
export const heroMatches = [
  {
    id: 'ANRF/PMECRG/2026/041',
    programme: 'ANRF · Prime Minister Early Career',
    title: 'Stable wide-bandgap perovskites for tandem photovoltaics',
    score: 94,
    tier: 'strong' as const,
    closes: 'closes in 38 days',
  },
  {
    id: 'DST/TMD/CERI/2026',
    programme: 'DST · Clean Energy Research Initiative',
    title: 'Materials for low-cost solar deployment',
    score: 88,
    tier: 'strong' as const,
    closes: 'closes in 61 days',
  },
  {
    id: 'SERB/CRG/2026/0117',
    programme: 'SERB · Core Research Grant',
    title: 'Defect engineering in thin-film semiconductors',
    score: 74,
    tier: 'moderate' as const,
    closes: 'closes in 12 days',
  },
  {
    id: 'HORIZON-CL5-2026-D3-02',
    programme: 'Horizon Europe · Cluster 5',
    title: 'Next-generation PV for the built environment',
    score: 69,
    tier: 'moderate' as const,
    closes: 'open',
  },
]

export const heroEligibility = [
  { label: 'PhD awarded within 7 years', state: 'met' as const },
  { label: 'Regular faculty at a recognised institution', state: 'met' as const },
  { label: 'No other ANRF grant held as PI', state: 'met' as const },
  { label: 'Institutional endorsement letter', state: 'action' as const },
]

export const heroPrecedents = [
  'Perovskite tandem stability · ₹48L · DST · 2024',
  'Solution-processed PV interfaces · ₹36L · SERB · 2023',
  'Encapsulation for humid climates · ₹52L · ANRF · 2025',
]

/** Profile mapping: the worked example the mapping section is built on. */
export const mappingProfile = {
  name: 'Dr. Anita Rao',
  role: 'Associate Professor, Department of Physics',
  inputs: [
    { label: '14 journal papers', detail: 'pulled from Scopus in one click' },
    { label: '2 research areas', detail: 'you choose these yourself' },
    { label: '1 completed SERB grant', detail: 'adds funded-track evidence' },
  ],
  disciplines: [
    { name: 'Materials science', weight: 94 },
    { name: 'Renewable energy', weight: 81 },
    { name: 'Condensed matter physics', weight: 62 },
    { name: 'Chemical engineering', weight: 28 },
  ],
  result: { scanned: 214, eligible: 38, strong: 6 },
}

/** Alerts: the message a researcher actually receives. */
export const alertMessage = {
  time: '09:12',
  headline: 'New call matched to your profile — 94% fit',
  lines: [
    'ANRF Prime Minister Early Career Fellowship',
    'Perovskite and tandem photovoltaics',
    'Closes 28 Oct · 38 days left',
  ],
  matchedOn: 'perovskite stability, tandem PV, defect passivation',
}

export const digestRows = [
  { title: 'ANRF PM Early Career Fellowship', score: 94, closes: '38d' },
  { title: 'DST Clean Energy Research Initiative', score: 88, closes: '61d' },
  { title: 'SERB Core Research Grant', score: 74, closes: '12d' },
]

/** Chatbot: a real-shaped exchange, not a marketing slogan. */
export const chatTurns = [
  {
    role: 'user' as const,
    text: 'Which agencies have funded solid-state battery work in the last three years, and what did they pay?',
  },
  {
    role: 'assistant' as const,
    text: 'Four funders, 61 projects since 2023. DST leads on count, ANRF on average size.',
    table: [
      ['DST', '24 projects', '₹31L avg'],
      ['ANRF / SERB', '18 projects', '₹47L avg'],
      ['DRDO', '11 projects', '₹64L avg'],
      ['BIRAC', '8 projects', '₹22L avg'],
    ],
    footer: 'The DST Materials for Energy Storage call is open, closes in 44 days, and you clear every eligibility rule.',
  },
  {
    role: 'user' as const,
    text: 'What did the funded ones have that mine does not?',
  },
  {
    role: 'assistant' as const,
    text: 'Nineteen of the 24 DST awards named an industry partner and a TRL target at the outset. Your draft names neither. That is the largest single gap between you and the funded set.',
  },
]

/** AI reviewer: before and after, because the delta is the argument. */
export const reviewCriteria = [
  { criterion: 'Scientific merit', weight: '30%', before: 3.4, after: 4.2 },
  { criterion: 'Feasibility and methodology', weight: '25%', before: 2.1, after: 4.4 },
  { criterion: 'Expected impact', weight: '25%', before: 2.6, after: 4.1 },
  { criterion: 'Budget justification', weight: '20%', before: 2.9, after: 4.5 },
]

export const reviewFindings = [
  {
    severity: 'critical' as const,
    criterion: 'Feasibility and methodology',
    finding: 'No characterisation plan behind the accelerated-ageing claim in Objective 2.',
    fix: 'Name the test standard (IEC 61215), the sample count, and the facility that runs it.',
  },
  {
    severity: 'critical' as const,
    criterion: 'Budget justification',
    finding: '₹18L of equipment is requested but used by no listed work package.',
    fix: 'Tie every line item to a work package, or remove it.',
  },
  {
    severity: 'major' as const,
    criterion: 'Expected impact',
    finding: 'Impact is written as a benefit to science, not to the mission this call funds.',
    fix: 'Restate impact against the call’s stated outcome: domestic manufacturing readiness.',
  },
]

/** Patent search: prior art for the same worked example, so the novelty gap is visible. */
export const patentQuery = 'encapsulation stack for tandem PV modules in humid climates'

export const patentResults = [
  {
    number: 'IN 402118',
    title: 'Polymer encapsulant composition for photovoltaic laminates',
    assignee: 'Indian Institute of Technology',
    year: '2022',
    relevance: 71,
    overlap: 'Encapsulant chemistry, but silicon single-junction only',
  },
  {
    number: 'IN 389442',
    title: 'Moisture barrier film for solar module back sheets',
    assignee: 'Private applicant',
    year: '2021',
    relevance: 64,
    overlap: 'Barrier film, no tandem or perovskite layer',
  },
  {
    number: 'IN 445907',
    title: 'Edge sealing method for perovskite solar cells',
    assignee: 'CSIR',
    year: '2024',
    relevance: 58,
    overlap: 'Edge seal, not the full stack under damp heat',
  },
]

export const patentVerdict = {
  searched: 34,
  closest: 71,
  claim:
    'No granted Indian patent covers a tandem-specific encapsulation stack qualified under damp-heat cycling. That absence is the novelty paragraph.',
}

/** Templates: structures taken from proposals these agencies actually funded. */
export const templates = [
  {
    agency: 'ANRF / SERB',
    kind: 'Core Research Grant',
    sections: 12,
    note: 'Objective phrasing, work-package split and budget heads drawn from funded CRG awards.',
  },
  {
    agency: 'DST',
    kind: 'Technology Mission Division',
    sections: 14,
    note: 'TRL statement, industry-partner letter and deliverable table in the form DST expects.',
  },
  {
    agency: 'DBT / BIRAC',
    kind: 'Biotechnology R&D',
    sections: 16,
    note: 'Biosafety and ethics annexures, plus the translational-pathway section reviewers look for.',
  },
  {
    agency: 'ICMR',
    kind: 'Extramural Research',
    sections: 13,
    note: 'Study design, sample-size justification and the budget heads that get proposals returned.',
  },
]

/** The funded-project corpus behind matching, positioning and templates. */
export const corpusRows = [
  ['DST', 'Energy storage materials', '₹31L', '2025', '412'],
  ['ANRF / SERB', 'Semiconductor devices', '₹47L', '2025', '689'],
  ['DBT', 'Vaccine platforms', '₹1.2Cr', '2024', '233'],
  ['ICMR', 'Non-communicable disease', '₹68L', '2024', '341'],
  ['BIRAC', 'Medical devices', '₹22L', '2025', '178'],
  ['CSIR', 'Industrial catalysis', '₹39L', '2023', '256'],
]

/** Funders that have paid for work in the example field, ranked by project count. */
export const fieldFunders = [
  { name: 'DST', projects: 268, awarded: '₹81Cr' },
  { name: 'ANRF / SERB', projects: 194, awarded: '₹92Cr' },
  { name: 'MNRE', projects: 143, awarded: '₹61Cr' },
  { name: 'CSIR', projects: 87, awarded: '₹29Cr' },
  { name: 'MeitY', projects: 41, awarded: '₹14Cr' },
]

export const fieldMatrixYears = ['2021', '2022', '2023', '2024', '2025']

/** Sub-topic × year funded-project counts. The `open` row is the gap the engine found. */
export const fieldMatrixRows = [
  { topic: 'Silicon PV efficiency', counts: [31, 36, 42, 39, 44] },
  { topic: 'Perovskite synthesis', counts: [18, 24, 29, 33, 31] },
  { topic: 'Module encapsulation', counts: [9, 13, 18, 21, 26] },
  { topic: 'Tandem cell design', counts: [5, 8, 12, 15, 13] },
  { topic: 'Humid-climate ageing', counts: [1, 2, 0, 1, 2], open: true },
]

/** Training: agency-specific sessions run by former agency scientists. */
export const trainingSessions = [
  {
    agency: 'ANRF',
    title: 'What the Early Career panel actually scores',
    host: 'Former SERB programme officer, 11 years',
    cadence: 'Every second Thursday',
  },
  {
    agency: 'DBT',
    title: 'Writing the biosafety and ethics annexure',
    host: 'Retired DBT scientist, ex-review committee',
    cadence: 'Monthly',
  },
  {
    agency: 'ICMR',
    title: 'Budget heads that get proposals returned',
    host: 'Former ICMR grants administrator',
    cadence: 'Monthly',
  },
]

/** Research administration: the board a DSR office works from. */
export const officeRows = [
  { school: 'School of Physical Sciences', matched: 34, claimed: 28, submitted: 11, risk: 'ok' as const },
  { school: 'School of Bioengineering', matched: 41, claimed: 39, submitted: 17, risk: 'ok' as const },
  { school: 'School of Chemical Engineering', matched: 22, claimed: 9, submitted: 3, risk: 'watch' as const },
  { school: 'School of Computer Science', matched: 58, claimed: 21, submitted: 6, risk: 'watch' as const },
]

export const officeAlerts = [
  { text: 'DST CERI closes in 12 days — 9 matched faculty, nobody has claimed it', tone: 'urgent' as const },
  { text: 'Chemical Engineering has 13 matched calls unclaimed this month', tone: 'watch' as const },
  { text: 'Bioengineering submissions are up 41% on last funding window', tone: 'good' as const },
]

export const audienceCards = [
  {
    title: 'Researchers and faculty',
    body: 'The calls that fit your actual work, the evidence of what won before, and a reviewer’s verdict while you can still act on it.',
    cta: 'Free to start',
  },
  {
    title: 'Deans and heads of school',
    body: 'See which faculty are matched to open calls, who has claimed them, and which deadlines are about to pass with nobody on them.',
    cta: 'Institution plan',
  },
  {
    title: 'Research and DSR offices',
    body: 'Assign calls to schools, chase follow-ups, and report submissions per school and per funding window without a spreadsheet.',
    cta: 'Institution plan',
  },
  {
    title: 'Startups, SMEs and consultants',
    body: 'Find non-dilutive routes through BIRAC, DST, MeitY and the EU, and pressure-test more proposals with less manual searching.',
    cta: 'Talk to us',
  },
]

export const faqs = [
  {
    q: 'Is my unpublished proposal safe here?',
    a: 'Your drafts and ideas stay inside your institution’s own tenant. They are never shared with another institution and never used to train models. Encrypted in transit and at rest, role-based access for research offices, SSO on request.',
  },
  {
    q: 'Does this really cover Indian agencies?',
    a: 'Yes. ANRF, SERB, DST, DBT, ICMR, CSIR, BIRAC, MeitY, ICAR, AICTE and state councils, alongside Horizon Europe, NIH, NSF, UKRI and the major foundations. New sources are added on request during a pilot.',
  },
  {
    q: 'Does the AI write my proposal for me?',
    a: 'No. It finds the calls, shows what the agency has funded before, gives you a structure that has worked, and reviews what you wrote against the rubric. The science stays yours — that is the part reviewers can tell.',
  },
  {
    q: 'How much work is this for my research office?',
    a: 'Setup is a faculty list and your school structure. After that the mapping runs on its own, and the office works from a queue of open calls and follow-ups instead of from its inbox.',
  },
  {
    q: 'What does it cost?',
    a: 'Individual researchers start free. Institution pricing is per school and includes the administration module, alerting and the training series. Book a demo and we will size it for your campus.',
  },
]
