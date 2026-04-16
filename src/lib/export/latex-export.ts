import type { CitationData } from '@/lib/services/citation-style-service';
import { exportCitationsToBibtex } from '@/lib/export/bibtex-export';
import { getLatexFontSetup } from '@/lib/export/export-profile-schema';

export interface LatexSection {
  key: string;
  title: string;
  content: string;
}

export interface LatexFigure {
  figureNo: number;
  caption: string;
  imagePath?: string;
}

export interface LatexFormatting {
  marginInches?: number;
  lineSpacing?: number;
  fontSizePt?: number;
  documentClass?: string;
  documentClassOptions?: string[];
  columnLayout?: 1 | 2;
  latexPackages?: string[];
  latexPreambleExtra?: string;
  bibliographyStyle?: string;
  citationCommand?: string;
  includePageNumbers?: boolean;
  margins?: { topCm: number; bottomCm: number; leftCm: number; rightCm: number };
  pageSize?: 'A4' | 'LETTER' | 'A5';
  fontFamily?: string;
  sectionNumbering?: boolean;
}

export interface LatexExportInput {
  title: string;
  sections: LatexSection[];
  figures?: LatexFigure[];
  citations?: CitationData[];
  bibliographyStyle?: string;
  formatting?: LatexFormatting;
}

export interface LatexExportResult {
  latex: string;
  bibtex: string;
}

const BASE_PACKAGES = ['geometry', 'setspace', 'graphicx', 'hyperref'];

export function buildLatexExport(input: LatexExportInput): LatexExportResult {
  const lines: string[] = [];
  const formatting = input.formatting || {};
  const fontSize = formatting.fontSizePt ?? 12;
  const documentClass = formatting.documentClass || 'article';
  const lineSpacing = formatting.lineSpacing ?? 1.5;
  const bibliographyStyle = formatting.bibliographyStyle || input.bibliographyStyle || 'plain';
  const citationCommand = formatting.citationCommand || '\\cite';
  const includePageNumbers = formatting.includePageNumbers !== false;
  const sectionNumbering = formatting.sectionNumbering !== false;
  const hasTwoColumnOption = (formatting.documentClassOptions || [])
    .some((option) => String(option || '').trim().toLowerCase() === 'twocolumn');
  const documentClassOptions = dedupeStrings([
    `${fontSize}pt`,
    pageSizeOption(formatting.pageSize),
    ...(formatting.documentClassOptions || []),
  ]);
  const useMulticol = formatting.columnLayout === 2 && !hasTwoColumnOption && documentClass !== 'IEEEtran';
  const fontSetup = getLatexFontSetup(formatting.fontFamily || 'Times New Roman');
  const packages = dedupeStrings([
    ...BASE_PACKAGES,
    citationCommand === '\\citep' || citationCommand === '\\citet' ? 'natbib' : bibliographyStyle.toLowerCase().startsWith('ieee') ? 'cite' : '',
    useMulticol ? 'multicol' : '',
    fontSetup.packageName || '',
    ...(formatting.latexPackages || []),
  ]);
  const geometryOptions = formatting.margins
    ? [
        pageSizeOption(formatting.pageSize),
        `top=${formatting.margins.topCm}cm`,
        `bottom=${formatting.margins.bottomCm}cm`,
        `left=${formatting.margins.leftCm}cm`,
        `right=${formatting.margins.rightCm}cm`,
      ].filter(Boolean)
    : [`margin=${formatting.marginInches ?? 1}in`, pageSizeOption(formatting.pageSize)].filter(Boolean);
  const bibtex = exportCitationsToBibtex(input.citations || []);

  lines.push(`\\documentclass[${documentClassOptions.join(',')}]{${sanitizeLatexIdentifier(documentClass)}}`);
  lines.push(`\\usepackage[${geometryOptions.join(',')}]{geometry}`);
  for (const pkg of packages.filter((pkg) => pkg !== 'geometry')) {
    lines.push(`\\usepackage{${sanitizeLatexIdentifier(pkg)}}`);
  }
  if (fontSetup.fontCommand) {
    lines.push(fontSetup.fontCommand);
  }
  if (!includePageNumbers) {
    lines.push('\\pagestyle{empty}');
  }
  lines.push(`\\setstretch{${lineSpacing}}`);
  if (formatting.latexPreambleExtra?.trim()) {
    lines.push(formatting.latexPreambleExtra.trim());
  }
  lines.push('');
  lines.push(...buildFrontMatter(documentClass, input.title || 'Untitled Paper'));
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');
  lines.push('');

  const abstractSection = input.sections.find((section) => section.key.toLowerCase() === 'abstract');
  const bodySections = input.sections.filter((section) => section.key.toLowerCase() !== 'abstract');

  if (abstractSection) {
    lines.push('\\begin{abstract}');
    lines.push(normalizeLatexContent(abstractSection.content, citationCommand));
    lines.push('\\end{abstract}');
    lines.push('');
  }

  if (useMulticol && bodySections.length > 0) {
    lines.push('\\begin{multicols}{2}');
  }

  for (const section of bodySections) {
    const command = sectionNumbering ? '\\section' : '\\section*';
    lines.push(`${command}{${escapeLatex(section.title)}}`);
    lines.push(normalizeLatexContent(section.content, citationCommand));
    lines.push('');
  }

  if (useMulticol && bodySections.length > 0) {
    lines.push('\\end{multicols}');
    lines.push('');
  }

  if (input.figures && input.figures.length > 0) {
    lines.push(sectionNumbering ? '\\section{Figures}' : '\\section*{Figures}');
    for (const figure of input.figures) {
      lines.push('\\begin{figure}[htbp]');
      lines.push('\\centering');
      if (figure.imagePath) {
        lines.push(`\\includegraphics[width=\\linewidth]{${figure.imagePath.replace(/\\/g, '/')}}`);
      } else {
        lines.push(`% Figure ${figure.figureNo} has no bundled image asset`);
      }
      lines.push(`\\caption{${escapeLatex(figure.caption)}}`);
      lines.push('\\end{figure}');
      lines.push('');
    }
  }

  if ((input.citations || []).length > 0 || bibtex.trim()) {
    lines.push(`\\bibliographystyle{${sanitizeLatexIdentifier(bibliographyStyle)}}`);
    lines.push('\\bibliography{references}');
  }

  lines.push('\\end{document}');

  return {
    latex: lines.join('\n'),
    bibtex,
  };
}

function buildFrontMatter(documentClass: string, title: string): string[] {
  const escapedTitle = escapeLatex(title || 'Untitled Paper');
  if (documentClass === 'IEEEtran') {
    return [
      `\\title{${escapedTitle}}`,
      '\\author{',
      '  \\IEEEauthorblockN{Generated Manuscript}\\\\',
      '  \\IEEEauthorblockA{Papsi Export}',
      '}',
      '\\date{}',
    ];
  }

  if (documentClass === 'acmart') {
    return [
      `\\title{${escapedTitle}}`,
      '\\author{Generated Manuscript}',
      '\\affiliation{\\institution{Papsi Export}}',
      '\\email{noreply@example.com}',
      '\\renewcommand{\\shortauthors}{Generated Manuscript}',
    ];
  }

  if (documentClass === 'llncs') {
    return [
      `\\title{${escapedTitle}}`,
      '\\author{Generated Manuscript}',
      '\\institute{Papsi Export}',
    ];
  }

  if (documentClass === 'custom') {
    return [
      '% WARNING: custom export class uses generic front matter; adjust author macros if your template requires them.',
      `\\title{${escapedTitle}}`,
      '\\author{Generated Manuscript}',
      '\\date{}',
    ];
  }

  return [
    `\\title{${escapedTitle}}`,
    '\\author{Generated Manuscript}',
    '\\date{}',
  ];
}

function normalizeLatexContent(content: string, citationCommand: string): string {
  const citations: Array<{ token: string; key: string }> = [];
  let counter = 0;
  const withPlaceholders = content.replace(/\[CITE:([^\]]+)\]/g, (_, key) => {
    const token = `CITETOKEN${counter += 1}`;
    citations.push({ token, key });
    return token;
  }).replace(/\r\n/g, '\n');

  let escaped = withPlaceholders
    .split('\n')
    .map((line) => escapeLatex(line))
    .join('\n');

  citations.forEach(({ token, key }) => {
    escaped = escaped.split(token).join(`${citationCommand}{${key}}`);
  });

  return escaped;
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function sanitizeLatexIdentifier(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '');
}

function pageSizeOption(pageSize?: 'A4' | 'LETTER' | 'A5'): string {
  if (pageSize === 'LETTER') return 'letterpaper';
  if (pageSize === 'A5') return 'a5paper';
  if (pageSize === 'A4') return 'a4paper';
  return '';
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}
