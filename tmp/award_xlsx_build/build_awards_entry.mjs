import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/raman/Documents/Grapsi/outputs/the_awards_asia_grapsi";
const outputPath = `${outputDir}/LPU_THE_Awards_Asia_2027_Grapsi_Nomination.xlsx`;
const previewPath = `${outputDir}/LPU_THE_Awards_Asia_2027_Grapsi_Nomination_preview.png`;

const submissionText = `Lovely Professional University supports a multidisciplinary community of more than 1,100 researchers. Yet identifying suitable funding opportunities, interpreting complex calls, assessing the originality of research ideas and connecting researchers with the right schemes were traditionally fragmented and time-intensive activities. Faculty often depended on manual searches and individual networks, while institutional teams lacked a unified, evidence-based view of the funding landscape.

To address this challenge, LPU developed and implemented Grapsi, an AI-enabled grant intelligence and proposal-review platform. Grapsi transforms grant development from a reactive administrative process into a proactive, data-informed research support system.

At its core is an intelligence repository of more than 50,000 sanctioned projects from major Indian and international funding agencies. Grapsi compares new research ideas with previously funded work, identifies crowded areas, reveals underexplored research “white spaces” and helps researchers position proposals where their expertise and ideas show stronger potential.

The platform brings together researcher profiles, funding-call requirements, sanctioned-project evidence and proposal content across the grant journey. It maps relevant opportunities to faculty, highlights thematic alignment, retrieves comparable funded projects and reviews proposals against the expectations of a specific call. Its recommendations are grounded in funding documents and project evidence, allowing researchers and institutional reviewers to understand the basis for each suggestion rather than relying on generic AI-generated advice.

The initiative has produced measurable institution-wide results. LPU has circulated more than 450 targeted funding calls to relevant faculty instead of relying only on undifferentiated mass communication. Through direct researcher-to-call mapping, the university has supported the preparation and submission of more than 800 grant applications. These efforts have already contributed to approximately ₹1.8 crore in secured research funding.

Grapsi has also reduced the manual effort involved in discovering opportunities, studying previously funded projects and conducting preliminary proposal reviews. It has widened participation by enabling researchers beyond established funding networks to discover appropriate schemes and strengthen the positioning of their ideas.

Implementing an AI-enabled system across a large and diverse research community required LPU to address varying levels of digital confidence, concerns about AI reliability and established working practices. LPU adopted a human-in-the-loop model in which evidence is visible and technology strengthens, rather than replaces, academic and expert judgement.

The approach can scale across disciplines, agencies and institutional structures. By converting historical funding decisions into an active research intelligence resource, LPU has created a replicable model for improving grant participation, research productivity and funding outcomes across higher education.`;

const abridgedText = `Lovely Professional University created Grapsi to transform grant development for its community of more than 1,100 researchers. The AI-enabled platform connects researcher expertise with funding opportunities and analyses a repository of over 50,000 sanctioned projects to identify comparable funded work, crowded research areas and underexplored “white spaces”. It also supports evidence-based proposal review against the requirements of individual funding calls.

LPU has used Grapsi to circulate more than 450 targeted funding calls and support the mapping, preparation and submission of over 800 grant applications. These efforts have contributed to approximately ₹1.8 crore in secured research funding. By reducing manual opportunity discovery and helping researchers position proposals using evidence from earlier funding decisions, Grapsi has improved research support across disciplines. Its human-in-the-loop approach keeps academic judgement central, while its adaptable architecture offers a scalable model that other higher education institutions can replicate.`;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const submissionWords = wordCount(submissionText);
const abridgedWords = wordCount(abridgedText);
if (submissionWords > 500) throw new Error(`Submission text exceeds 500 words: ${submissionWords}`);
if (abridgedWords > 150) throw new Error(`Abridged text exceeds 150 words: ${abridgedWords}`);

const rows = [
  ["Sr. No.", "Question", "Brief guidelines to answer the question", "Response", "Remarks"],
  [1, "Nominee or key personnel", "If there is a specific nominee, or you wish to highlight the involvement of a team, please do so here.", "Project team: Division of Research and Development, Lovely Professional University.\nLead nominee/key personnel: To be confirmed by LPU.", "Add the names and official designations of the principal institutional and technical leads."],
  [2, "Submission title or project name", "Write the name of the project.", "From Opportunity to Impact: LPU’s AI-Enabled Grant Intelligence Ecosystem", "Working title; LPU may approve or revise it before submission."],
  [3, "Project URL or link to further information about your entry (if applicable)", "If your project has a dedicated website or your work is featured elsewhere, please provide the URL here. We will publish this link alongside the short submission text if this entry is shortlisted.", "To be confirmed by LPU.", "Provide a stable public page suitable for publication if the entry is shortlisted."],
  [4, "Institution name", "Name of the institution.", "Lovely Professional University", ""],
  [5, "Institution country or territory", "Country where the institution is situated.", "India", ""],
  [6, "Submission text (maximum 500 words)", "Please note that other programmes may have a slightly different word count. Add the text to the entry form as early as possible before final editing to meet the strict 500-word limit. The text can be saved as a draft and revised.", submissionText, `Word count: ${submissionWords}/500.\nCategory criteria: https://theawardsasia.com/2027/en/page/entry-form`],
  [7, "Edited submission for publication if shortlisted (maximum 150 words)", "This version will be published on the THE Awards Asia website if shortlisted, so do not include sensitive or confidential information.", abridgedText, `Word count: ${abridgedWords}/150. Public-facing version.`],
  [8, "Upload supporting materials", "You may upload one or two supporting documents, but together they must not exceed four sides of A4. They should be in Word or PDF format. Supporting material may include photographs, tables, statistics, testimonials, research, evaluation reports, press cuttings and promotional material. Highlight relevant sections. PowerPoint and video files cannot be accepted, although screenshots or links may be included.", "Supporting material 1 — Institutional results and adoption evidence (maximum two A4 pages): 1,100-researcher reach; 450 targeted funding calls; more than 800 mapped and submitted applications; approximately ₹1.8 crore secured; departmental coverage; and a concise before-and-after workflow.\n\nSupporting material 2 — Platform evidence and user experience (maximum two A4 pages): screenshots of grant mapping, sanctioned-project comparison, white-space analysis and proposal review; two or three faculty case studies or testimonials; and a short note on governance, human review and scalability.", "Prepare one or two PDF/Word files, with a combined maximum of four A4 pages. Every major statistic in the main submission should be supported here.\nGuidelines: https://theawardsasia.com/2027/en/page/entry-guidelines"],
  [9, "Further details", "If you are not involved in the project or work featured in the entry, provide the name and email address of someone prepared to answer questions.\n\nAdditional contact — name\nAdditional contact — email address", "Additional contact — name: To be confirmed by LPU\nAdditional contact — email address: To be confirmed by LPU", "Use an institutional contact who can verify the implementation and impact figures."],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("THE Awards Asia Entry");
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange("A1:E10").values = rows;

const all = sheet.getRange("A1:E10");
all.format.font = { name: "Arial", size: 10, color: "#111111" };
all.format.wrapText = true;
all.format.verticalAlignment = "top";
all.format.borders = { preset: "all", style: "thin", color: "#6B7280" };

const header = sheet.getRange("A1:E1");
header.format.fill = "#D9E2F3";
header.format.font = { name: "Arial", size: 10, bold: true, color: "#111111" };
header.format.horizontalAlignment = "center";
header.format.verticalAlignment = "center";

sheet.getRange("A2:A10").format.horizontalAlignment = "center";
sheet.getRange("A2:A10").format.verticalAlignment = "center";
sheet.getRange("B2:B10").format.font = { name: "Arial", size: 10, bold: true, color: "#111111" };
sheet.getRange("D2:D10").format.fill = "#FFFDF5";
sheet.getRange("E2:E10").format.fill = "#F8FAFC";
sheet.getRange("D2").format.fill = "#FFF2CC";
sheet.getRange("D4").format.fill = "#FFF2CC";
sheet.getRange("D10").format.fill = "#FFF2CC";

sheet.getRange("A1:A10").format.columnWidthPx = 62;
sheet.getRange("B1:B10").format.columnWidthPx = 205;
sheet.getRange("C1:C10").format.columnWidthPx = 440;
sheet.getRange("D1:D10").format.columnWidthPx = 790;
sheet.getRange("E1:E10").format.columnWidthPx = 255;

sheet.getRange("1:1").format.rowHeightPx = 32;
sheet.getRange("2:2").format.rowHeightPx = 84;
sheet.getRange("3:3").format.rowHeightPx = 62;
sheet.getRange("4:4").format.rowHeightPx = 108;
sheet.getRange("5:6").format.rowHeightPx = 42;
sheet.getRange("7:7").format.rowHeightPx = 520;
sheet.getRange("8:8").format.rowHeightPx = 215;
sheet.getRange("9:9").format.rowHeightPx = 265;
sheet.getRange("10:10").format.rowHeightPx = 120;

sheet.getRange("D7").format.font = { name: "Arial", size: 9, color: "#111111" };
sheet.getRange("D8:D9").format.font = { name: "Arial", size: 9, color: "#111111" };

await fs.mkdir(outputDir, { recursive: true });

const preview = await workbook.render({
  sheetName: "THE Awards Asia Entry",
  range: "A1:E10",
  scale: 0.8,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const inspection = await workbook.inspect({
  kind: "table",
  range: "THE Awards Asia Entry!A1:E10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 5,
  maxChars: 12000,
});
console.log(inspection.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath, submissionWords, abridgedWords }));
