/* Temporary: render every email template with sample data into one preview page. */
import fs from 'fs'
import * as T from './src/lib/email-templates'

const OUT = process.argv[2] || './tmp-email-preview.html'

type Rendered = { key: string; group: string; to: string; when: string; subject: string; html: string; text: string }
const out: Rendered[] = []
const add = (key: string, group: string, to: string, when: string, r: { subject: string; html: string; text: string }) =>
  out.push({ key, group, to, when, subject: r.subject, html: r.html, text: r.text })

const d = (s: string) => s

// ---- Funding department: DSR members ---------------------------------------
add('fundingDeptWeeklyMemberTemplate', 'DSR member', 'Dr Anjali Verma (covering officer)', 'Mondays 03:35 IST',
  T.fundingDeptWeeklyMemberTemplate({
    email: 'anjali.verma@lpu.co.in',
    name: 'Dr Anjali Verma',
    active: 11,
    missed: 3,
    declined: 2,
    dueSoon: [
      { callTitle: 'SERB Core Research Grant 2026-27', facultyName: 'Dr Rakesh Nair', deadline: '28 Sep 2026' },
      { callTitle: 'DST-SERB Power Electronics Cluster Call', facultyName: 'Dr Meera Iyer', deadline: '4 Oct 2026' },
      { callTitle: 'ICMR Adhoc Scheme — Nutrition', facultyName: null, deadline: '12 Oct 2026' },
    ],
    overdueReminders: [
      { note: 'Chase Dr Nair for the budget sheet before the internal cut-off', facultyName: 'Dr Rakesh Nair' },
      { note: 'Confirm co-PI consent letter from School of Pharmacy', facultyName: 'Dr Simran Kaur' },
    ],
    openCalls: [
      { title: 'DBT Biotechnology Ignition Grant', closesAt: '30 Sep 2026' },
      { title: 'MeitY Semiconductor Fellowship', closesAt: '7 Oct 2026' },
    ],
    dashboardUrl: 'https://aigrantmentor.com/funding-dept',
  }))

add('assignmentReminderTemplate (officer follow-up)', 'DSR member', 'Dr Anjali Verma', 'Hourly :05',
  T.assignmentReminderTemplate({
    email: 'anjali.verma@lpu.co.in',
    name: 'Dr Anjali Verma',
    callTitle: 'SERB Core Research Grant 2026-27',
    deadline: '28 Sep 2026',
    note: 'Chase Dr Nair for the budget sheet before the internal cut-off',
    fromName: null,
  }))

add('proposalVersionUploadedTemplate', 'DSR member', 'Dr Anjali Verma', 'Hourly :40',
  T.proposalVersionUploadedTemplate({
    email: 'anjali.verma@lpu.co.in',
    name: 'Dr Anjali Verma',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    researcherName: 'Dr Rakesh Nair',
    versionNo: 2,
    note: 'Reworked the budget after your note on the equipment head.',
    proposalId: 'prp_8c41',
  }))

add('proposalReviewSlaTemplate', 'DSR member', 'Dr Anjali Verma', 'Hourly :40',
  T.proposalReviewSlaTemplate({
    email: 'anjali.verma@lpu.co.in',
    name: 'Dr Anjali Verma',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    researcherName: 'Dr Rakesh Nair',
    versionNo: 2,
    waitingDays: 5,
    state: 'unreviewed',
    proposalId: 'prp_8c41',
  }))

add('proposalFollowUpDueTemplate', 'DSR member', 'Dr Anjali Verma', 'Hourly :40',
  T.proposalFollowUpDueTemplate({
    email: 'anjali.verma@lpu.co.in',
    name: 'Dr Anjali Verma',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    note: 'Ask the agency portal helpdesk why the PI ID is not resolving.',
    proposalId: 'prp_8c41',
  }))

// ---- Faculty ----------------------------------------------------------------
add('assignmentNotificationTemplate', 'Faculty', 'Dr Rakesh Nair (assignee)', 'On assignment',
  T.assignmentNotificationTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    assignerName: 'Dr Anjali Verma',
    callTitle: 'SERB Core Research Grant 2026-27',
    agency: 'Science and Engineering Research Board',
    deadline: '28 Sep 2026',
    message: 'Your photovoltaics work maps closely to the materials theme. Happy to help with the budget.',
  }))

add('assignmentReminderTemplate (D7 deadline rung)', 'Faculty', 'Dr Rakesh Nair', 'Hourly :05',
  T.assignmentReminderTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    callTitle: 'SERB Core Research Grant 2026-27',
    deadline: '28 Sep 2026',
    note: 'The internal deadline is a week away.',
    fromName: 'Dr Anjali Verma',
  }))

add('assignmentReminderTemplate (NOACK, 7 days silent)', 'Faculty', 'Dr Rakesh Nair', 'Hourly :05',
  T.assignmentReminderTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    callTitle: 'SERB Core Research Grant 2026-27',
    deadline: '28 Sep 2026',
    note: 'No reply after 7 days: please accept or decline so the call can be reassigned.',
    fromName: 'Dr Anjali Verma',
  }))

add('fundingOpportunityTemplate', 'Faculty', 'Dr Meera Iyer (researcher profile match)', 'Hourly :20',
  T.fundingOpportunityTemplate({
    email: 'meera.iyer@lpu.co.in',
    name: 'Dr Meera Iyer',
    callTitle: 'DST-SERB Power Electronics Cluster Call 2026',
    agency: 'Department of Science & Technology',
    deadline: '4 Oct 2026',
    amount: '₹ 85,00,000 over 3 years',
    matchReason: 'Matches your saved area "wide-bandgap semiconductors" and two of your 2025 publications.',
    matchTier: 'strong',
    callUrl: 'https://aigrantmentor.com/funding/calls/fc_9d22',
  }))

add('fundingAlertDigestTemplate', 'Faculty', 'Dr Meera Iyer', 'Daily / Mondays 03:35 IST',
  T.fundingAlertDigestTemplate({
    email: 'meera.iyer@lpu.co.in',
    name: 'Dr Meera Iyer',
    frequency: 'weekly',
    items: [
      { title: 'DST-SERB Power Electronics Cluster Call 2026', agency: 'Department of Science & Technology', deadline: '4 Oct 2026', amount: '₹ 85,00,000', matchReason: 'Matches "wide-bandgap semiconductors".', callUrl: 'https://aigrantmentor.com/funding/calls/fc_9d22' },
      { title: 'MeitY Semiconductor Research Fellowship', agency: 'Ministry of Electronics & IT', deadline: '7 Oct 2026', amount: '₹ 40,00,000', matchReason: 'Overlaps your device-fabrication publications.', callUrl: 'https://aigrantmentor.com/funding/calls/fc_9d23' },
      { title: 'ANRF Prime Minister Early Career Research Grant', agency: 'Anusandhan National Research Foundation', deadline: '19 Oct 2026', amount: '₹ 30,00,000', matchReason: null, callUrl: 'https://aigrantmentor.com/funding/calls/fc_9d24' },
    ],
  }))

add('proposalReviewSharedTemplate', 'Faculty', 'Dr Rakesh Nair (applicant)', 'On share',
  T.proposalReviewSharedTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    agency: 'Science and Engineering Research Board',
    score: 6.4,
    recommendation: 'MAJOR_REVISION',
    officerNote: 'Strong science, thin on the scale-up plan. Fix the budget justification before the cut-off.',
    officerName: 'Dr Anjali Verma',
    priorityActions: [
      'Justify the ₹22L equipment head against the work plan',
      'Add measurable milestones for years 2 and 3',
      'Name the industry partner or drop the translation claim',
    ],
    proposalId: 'prp_8c41',
  }))

add('proposalCutoffTemplate (D1)', 'Faculty', 'Dr Rakesh Nair', 'Hourly :40',
  T.proposalCutoffTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    cutoffDate: '21 Sep 2026',
    daysLeft: 1,
    proposalId: 'prp_8c41',
  }))

add('proposalDocumentIssuedTemplate', 'Faculty', 'Dr Rakesh Nair', 'On issue',
  T.proposalDocumentIssuedTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    documentTitle: 'Endorsement Letter',
    referenceNo: 'LPU/DSR/END/2026/0417',
    issuedOn: '18 Sep 2026',
    signedBy: 'Prof. S. Ramachandran, Dean (Research)',
    proposalId: 'prp_8c41',
  }))

add('proposalObligationDueTemplate (overdue)', 'Faculty', 'Dr Rakesh Nair (awarded project)', 'Hourly :40',
  T.proposalObligationDueTemplate({
    email: 'rakesh.nair@lpu.co.in',
    name: 'Dr Rakesh Nair',
    proposalTitle: 'Perovskite tandem cells for tropical humidity regimes',
    obligation: 'Utilisation Certificate (Year 1)',
    dueDate: '31 Aug 2026',
    daysLeft: -11,
    proposalId: 'prp_8c41',
    forOfficer: false,
  }))

// ---- Head of department ------------------------------------------------------
add('fundingDeptWeeklyHeadTemplate', 'Department head', 'Prof. S. Ramachandran (DSR head)', 'Mondays 03:35 IST',
  T.fundingDeptWeeklyHeadTemplate({
    email: 'head.dsr@lpu.co.in',
    name: 'Prof. S. Ramachandran',
    memberRows: [
      { name: 'Dr Anjali Verma', schoolCount: 4, active: 11, submitted: 3, missed: 3, declined: 2, followUps: 6 },
      { name: 'Dr Simran Kaur', schoolCount: 3, active: 7, submitted: 5, missed: 0, declined: 1, followUps: 2 },
      { name: 'Mr Pratik Deshmukh', schoolCount: 5, active: 2, submitted: 0, missed: 8, declined: 4, followUps: 0 },
    ],
    uncoveredSchools: ['School of Design', 'School of Hotel Management'],
    backlog: { current: 14, previous: 9 },
    overviewUrl: 'https://aigrantmentor.com/funding-dept/overview',
  }))

// ---- Account lifecycle --------------------------------------------------------
add('activationTemplate', 'Account', 'A seeded faculty account', 'On roster import',
  T.activationTemplate({
    email: 'simran.kaur@lpu.co.in',
    name: 'Dr Simran Kaur',
    tenantName: 'Lovely Professional University',
    token: 'SAMPLE-TOKEN-DO-NOT-USE',
    expiresInHours: 72,
  }))

add('tenantInviteTemplate', 'Account', 'A new department colleague', 'On invite',
  T.tenantInviteTemplate({
    email: 'pratik.deshmukh@lpu.co.in',
    inviterName: 'Prof. S. Ramachandran',
    tenantName: 'Lovely Professional University',
    role: 'MEMBER',
    inviteLink: 'https://aigrantmentor.com/invite/SAMPLE-TOKEN',
    expiresAt: new Date('2026-09-25T00:00:00Z'),
  }))

add('adminPasswordResetTemplate', 'Account', 'A user who asked support for help', 'On admin reset',
  T.adminPasswordResetTemplate({
    email: 'pratik.deshmukh@lpu.co.in',
    name: 'Mr Pratik Deshmukh',
    token: 'SAMPLE-TOKEN-DO-NOT-USE',
    expiresInHours: 24,
  }))

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
console.log(`rendered ${out.length} templates -> ${OUT}`)
for (const r of out) console.log(`  [${r.group}] ${r.key}\n      SUBJECT: ${r.subject}`)
