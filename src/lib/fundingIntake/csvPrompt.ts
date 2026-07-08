import { FUNDING_FIELD_DEFINITIONS, ARRAY_FIELD_KEYS } from './constants';

// Guideline rule labels the CSV importer understands (left column values).
const GUIDELINE_ROW_EXAMPLES: Array<[string, string]> = [
  ['priority', 'Funder priority this call cares about'],
  ['must_address', 'Something every proposal must include'],
  ['avoid', 'Something proposals must not do'],
  ['evaluation_criterion', 'How reviewers will score proposals'],
  ['budget_rule', 'A budget restriction or cap'],
  ['duration_rule', 'A project duration/timeline limit'],
  ['format_rule', 'A page/word/formatting limit'],
  ['submission_rule', 'A submission or admin requirement'],
  ['deliverable_rule', 'A required output, report, or milestone'],
  ['reviewer_signal', 'A reviewer preference or signal'],
];

// Application template row labels the CSV importer understands. The value is
// "Item name: guidance" — one form item per row.
const TEMPLATE_ROW_EXAMPLES: Array<[string, string]> = [
  ['section', 'Project Summary: what this narrative section must cover'],
  ['question', 'Project title: a short discrete form field'],
  ['attachment', 'CV of principal investigator: a required upload or document'],
  ['scoring_criterion', 'Innovation: a review scoring criterion, with weight if stated'],
  ['budget_category', 'Equipment: an allowed budget line, with any cap'],
  ['admin_rule', 'Formatting: an application form or portal requirement'],
];

function csvCell(value: string): string {
  // Quote a cell if it contains a comma, quote, or newline.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A blank two-column (field,value) CSV the operator can download, fill in (or
 * hand to an LLM), and upload. Every basic call field is listed, followed by a
 * document link row, example guideline rows, and example application template
 * rows. List fields note the `|` separator convention.
 */
export function buildFundingCsvTemplate(): string {
  const lines: string[] = ['field,value'];

  for (const definition of FUNDING_FIELD_DEFINITIONS) {
    const hint = ARRAY_FIELD_KEYS.has(definition.key)
      ? `${definition.placeholder || definition.label} (separate multiple values with |)`
      : definition.placeholder || definition.description || definition.label;
    lines.push(`${definition.key},${csvCell(hint ? `# ${hint}` : '')}`);
  }

  lines.push('');
  lines.push('# Full call document — a direct PDF/DOCX link. It is downloaded and indexed automatically; separate multiple links with |.');
  lines.push('document_url,# https://agency.example.org/call-guidelines.pdf');

  lines.push('');
  lines.push('# Guideline rows below — repeat any label as many times as needed. Delete the # examples.');
  for (const [label, example] of GUIDELINE_ROW_EXAMPLES) {
    lines.push(`${label},${csvCell(`# ${example}`)}`);
  }

  lines.push('');
  lines.push('# Application template rows below — one row per form item; the value is "Item name: guidance". Repeat any label as needed. Delete the # examples.');
  for (const [label, example] of TEMPLATE_ROW_EXAMPLES) {
    lines.push(`${label},${csvCell(`# ${example}`)}`);
  }

  return lines.join('\n') + '\n';
}

export const FUNDING_CSV_UPLOAD_CHATGPT_PROMPT = `You are extracting structured data for Grapsi's funding intake system as a two-column CSV.

Task:
Read the funding call I give you — it may be a web page at a URL, an attached PDF, and/or pasted text — and return ALL of the following as one simple two-column CSV: (1) the basic call details, (2) the proposal guideline rules, (3) the application form template, and (4) the link to the official full call document. If a URL is given, open it and read the actual call page (and linked guideline pages when relevant). Put the official call/guideline/portal links you used in the official_urls row.

OUTPUT FORMAT — follow exactly:
- Output ONLY the CSV text. No explanation before or after. No markdown. No code fences (do not wrap it in \`\`\`).
- The very first line must be exactly: field,value
- Every other line is one entry: the field name, then a comma, then the value.
- Put each entry on ONE line. Never put a line break inside a value — if the source text has line breaks, replace them with spaces.

HOW THE VALUE IS READ (this removes the need to worry about quoting):
- Everything after the FIRST comma on a line is the value. So values may contain commas freely and you do NOT need quotes.
  Example: eligibility_text,Open to universities, NGOs, and hospitals in India
  → the value is "Open to universities, NGOs, and hospitals in India".
- Do not add surrounding quotes. Do not use tabs, semicolons, or "key = value" — always use a comma right after the field name.

FIELD NAMES:
- Use the EXACT field names listed below (lowercase with underscores). Do not translate, rename, capitalize, or invent field names.
- Include a row ONLY if the source clearly states that fact. Omit every field you cannot find. Never guess or fabricate dates, amounts, eligibility, or contacts.
- Do not include a basic call field twice. If a fact does not fit any field, leave it out.

VALUE FORMATS:
- Dates: YYYY-MM-DD only (e.g. 2026-09-30). If the source gives a vague date, omit the row.
- Amounts (amount_min, amount_max): digits only — no currency symbol and no words. Put the currency in the currency row (e.g. USD). "$1.2M" → amount_max,1200000 and currency,USD.
- is_rolling: true or false.
- List fields: separate multiple values with a pipe |  (e.g. disciplines,AI|Public Health|Materials Science). Do not use commas to separate list items.

PART 1 — Basic call fields (use these exact field names, at most once each):
${FUNDING_FIELD_DEFINITIONS.map((definition) => `- ${definition.key}${definition.description ? ` — ${definition.description}` : ''}`).join('\n')}

PART 2 — Full call document link (include when the call has an official PDF or Word document):
- document_url — the DIRECT download link to the official full call document (PDF or DOCX), e.g. document_url,https://agency.example.org/guidelines.pdf. Prefer links ending in .pdf or .docx. Separate multiple documents with |. Do not put normal web pages here — those belong in official_urls. The system downloads this file automatically and indexes its full text.

PART 3 — Guideline rows (rules about what makes a proposal GOOD). Repeat any of these labels as many times as needed; put ONE rule in the value of each row, in your own concise words:
- priority — a funder priority this call cares about
- must_address — required content every proposal must include
- avoid — a prohibition or exclusion
- evaluation_criterion — a scoring/rubric criterion
- budget_rule — a budget restriction or cap
- duration_rule — a project duration/timeline limit
- format_rule — a page/word/formatting limit
- submission_rule — a submission or administrative requirement
- deliverable_rule — a required output, report, or milestone
- reviewer_signal — a reviewer preference or signal

PART 4 — Application template rows (the STRUCTURE of the application form: what applicants fill in and submit). Repeat any of these labels as many times as needed, one form item per row. The value is the item name, then a colon and a space, then short guidance: label,Item name: guidance
- section — one narrative section of the proposal, in the order the form asks for them (e.g. section,Project Summary: Summarize objectives and expected impact in 300 words)
- question — one short discrete form field (e.g. question,Project title: Official title of the proposed project)
- attachment — one required upload or supporting document (e.g. attachment,CV of PI: Maximum 2 pages per CV)
- scoring_criterion — one criterion reviewers score, with its weight if stated (e.g. scoring_criterion,Innovation: Novelty of the approach, 30 points)
- budget_category — one allowed budget line, with any cap (e.g. budget_category,Equipment: Up to 20% of total budget)
- admin_rule — one administrative rule of the form itself (e.g. admin_rule,Font: Arial 11 with 2cm margins)
Template rules:
- List EVERY section and question of the application form you can find, in the form's order.
- The item name before the colon must be short (a few words). Put limits, word counts, and instructions after the colon.
- If the source does not describe the application form at all, output no template rows — never invent form sections.

EXAMPLE (this is the exact shape and style to produce — your values will differ):
field,value
agency_name,National Science Foundation
scheme_title,AI for Public Health
description,Supports applied AI research that improves health outcomes for underserved communities.
close_date,2026-09-30
is_rolling,false
amount_max,500000
currency,USD
disciplines,Artificial Intelligence|Public Health|Data Science
eligibility_text,Open to universities, research institutes, and non-profits based in the United States.
official_urls,https://nsf.example.org/ai-health
document_url,https://nsf.example.org/ai-health/full-call.pdf
priority,Advance equitable health outcomes for underserved populations
must_address,Include a data management and privacy plan
format_rule,Project narrative limited to 10 pages
submission_rule,Submit through the Research.gov portal before 5pm ET
section,Project Summary: Objectives, methods, and expected impact in max 300 words
section,Problem Statement: The public health problem and why AI is the right approach
section,Work Plan: Milestones and timeline across the project period
question,Project title: Official title of the proposed project
question,Requested amount: Total budget requested in USD
attachment,CV of principal investigator: Maximum 2 pages
attachment,Letter of institutional support: Signed by an authorized official
scoring_criterion,Intellectual merit: Scientific quality and rigor, 40 points
scoring_criterion,Broader impacts: Benefit to underserved communities, 30 points
budget_category,Personnel: Salaries for project staff
budget_category,Equipment: Up to 20% of total budget
admin_rule,Font and margins: Arial 11 with 2.5cm margins

Now produce the CSV for the funding call I provide. Return CSV only.`;
