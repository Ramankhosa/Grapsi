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

function csvCell(value: string): string {
  // Quote a cell if it contains a comma, quote, or newline.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A blank two-column (field,value) CSV the operator can download, fill in (or
 * hand to an LLM), and upload. Every basic call field is listed, followed by
 * example guideline rows. List fields note the `|` separator convention.
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
  lines.push('# Guideline rows below — repeat any label as many times as needed. Delete the # examples.');
  for (const [label, example] of GUIDELINE_ROW_EXAMPLES) {
    lines.push(`${label},${csvCell(`# ${example}`)}`);
  }

  return lines.join('\n') + '\n';
}

export const FUNDING_CSV_UPLOAD_CHATGPT_PROMPT = `You are extracting structured data for Grapsi's funding intake system as a two-column CSV.

Task:
Read the funding call I give you — it may be a web page at a URL, an attached PDF, and/or pasted text — and return the data as a simple two-column CSV. If a URL is given, open it and read the actual call page (and linked guideline pages when relevant). Put the official call/guideline/portal links you used in the official_urls row.

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
- Do not include a field twice. If a fact does not fit any field, leave it out.

VALUE FORMATS:
- Dates: YYYY-MM-DD only (e.g. 2026-09-30). If the source gives a vague date, omit the row.
- Amounts (amount_min, amount_max): digits only — no currency symbol and no words. Put the currency in the currency row (e.g. USD). "$1.2M" → amount_max,1200000 and currency,USD.
- is_rolling: true or false.
- List fields: separate multiple values with a pipe |  (e.g. disciplines,AI|Public Health|Materials Science). Do not use commas to separate list items.

Basic call fields (use these exact field names):
${FUNDING_FIELD_DEFINITIONS.map((definition) => `- ${definition.key}${definition.description ? ` — ${definition.description}` : ''}`).join('\n')}

Guideline rows — repeat any of these labels as many times as needed; put ONE rule in the value column of each row, in your own concise words:
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

Do NOT include any proposal template, application form, section list, questions, or attachment structure — those are handled separately.

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
priority,Advance equitable health outcomes for underserved populations
must_address,Include a data management and privacy plan
format_rule,Project narrative limited to 10 pages
submission_rule,Submit through the Research.gov portal before 5pm ET

Now produce the CSV for the funding call I provide. Return CSV only.`;
