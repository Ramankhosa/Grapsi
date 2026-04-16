export interface PaperDocxSection {
  key: string;
  title: string;
  content: string;
}

export interface PaperDocxFigure {
  figureNo: number;
  title?: string;
  caption?: string | null;
  description?: string | null;
  asset?: {
    fileName: string;
    buffer: Buffer;
  };
}

export interface PaperDocxFormatting {
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: number;
  marginsCm: { top: number; bottom: number; left: number; right: number };
  pageSize?: 'A4' | 'LETTER' | 'A5';
  columnLayout?: 1 | 2;
  includePageNumbers?: boolean;
  pageNumberPosition?: 'top-right' | 'bottom-center' | 'bottom-right';
  headerContent?: string;
  footerContent?: string;
  sectionNumbering?: boolean;
}

export interface PaperDocxExportInput {
  title: string;
  sections: PaperDocxSection[];
  bibliography?: string;
  figures?: PaperDocxFigure[];
  formatting: PaperDocxFormatting;
}

export async function buildPaperDocxBuffer(input: PaperDocxExportInput): Promise<Buffer> {
  const docx = loadDocx();
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    ImageRun,
    AlignmentType,
    Footer,
    Header,
    PageNumber,
    SectionType,
  } = docx as any;

  const fontFamily = input.formatting.fontFamily;
  const fontSizePt = input.formatting.fontSizePt;
  const fontSizeHalfPt = fontSizePt * 2;
  const lineSpacingTwips = Math.round(240 * input.formatting.lineSpacing);
  const margins = input.formatting.marginsCm;
  const pageSize = resolvePageSize(input.formatting.pageSize);
  const columnLayout = input.formatting.columnLayout === 2 ? 2 : 1;
  const includePageNumbers = input.formatting.includePageNumbers !== false;
  const pageNumberPosition = input.formatting.pageNumberPosition || 'bottom-center';
  const sectionNumbering = input.formatting.sectionNumbering !== false;

  const doc = new Document({
    sections: [],
    styles: {
      default: {
        document: {
          run: {
            size: fontSizeHalfPt,
            font: fontFamily
          }
        }
      },
      paragraphStyles: [
        {
          id: 'bodyStyle',
          name: 'Body',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            size: fontSizeHalfPt,
            color: '000000',
            font: fontFamily
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: {
              line: lineSpacingTwips,
              before: 0,
              after: 120
            }
          }
        },
        {
          id: 'headingStyle',
          name: 'Heading',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            size: fontSizeHalfPt + 4,
            color: '000000',
            bold: true,
            font: fontFamily
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: 240,
              after: 120
            }
          }
        }
      ]
    }
  });

  const children: any[] = [];
  const appendixChildren: any[] = [];
  const titleText = input.title || 'Untitled Paper';
  children.push(
    new Paragraph({
      text: titleText,
      heading: HeadingLevel.HEADING_1,
      style: 'headingStyle'
    })
  );

  let sectionIndex = 0;
  input.sections.forEach(section => {
    const normalizedKey = String(section.key || '').trim().toLowerCase();
    const shouldNumber = sectionNumbering && normalizedKey !== 'abstract';
    const headingText = shouldNumber
      ? `${++sectionIndex}. ${section.title}`
      : section.title;

    children.push(
      new Paragraph({
        text: headingText,
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    splitIntoParagraphs(section.content).forEach(text => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text, font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
    });
  });

  if (input.figures && input.figures.length > 0) {
    appendixChildren.push(
      new Paragraph({
        text: 'Figures',
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    input.figures.forEach(figure => {
      const imageRun = buildFigureImageRun({
        ImageRun,
        asset: figure.asset,
        availablePageWidthTwips: Math.round(pageSize.width * 20) - cmToTwips(margins.left) - cmToTwips(margins.right),
      });
      if (imageRun) {
        appendixChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [imageRun],
          })
        );
      }

      const captionParts = [`Figure ${figure.figureNo}.`];
      if (figure.title) captionParts.push(figure.title);
      if (figure.caption) {
        captionParts.push(figure.caption);
      } else if (figure.description) {
        captionParts.push(figure.description);
      }
      appendixChildren.push(
        new Paragraph({
          children: [new TextRun({ text: captionParts.join(' '), font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
      appendixChildren.push(new Paragraph({ text: '', style: 'bodyStyle' }));
    });
  }

  if (input.bibliography && input.bibliography.trim().length > 0) {
    appendixChildren.push(
      new Paragraph({
        text: 'References',
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    splitBibliography(input.bibliography).forEach(entry => {
      appendixChildren.push(
        new Paragraph({
          children: [new TextRun({ text: entry, font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
    });
  }

  const pageMargin = {
    top: cmToTwips(margins.top),
    bottom: cmToTwips(margins.bottom),
    left: cmToTwips(margins.left),
    right: cmToTwips(margins.right)
  };

  const header = buildHeaderFooter({
    HeaderOrFooter: Header,
    Paragraph,
    TextRun,
    AlignmentType,
    PageNumber,
    text: input.formatting.headerContent,
    includePageNumbers: includePageNumbers && pageNumberPosition === 'top-right',
    pageNumberAlignment: AlignmentType.RIGHT,
  });

  const footerAlignment = pageNumberPosition === 'bottom-right'
    ? AlignmentType.RIGHT
    : AlignmentType.CENTER;
  const footer = buildHeaderFooter({
    HeaderOrFooter: Footer,
    Paragraph,
    TextRun,
    AlignmentType,
    PageNumber,
    text: input.formatting.footerContent,
    includePageNumbers: includePageNumbers && pageNumberPosition !== 'top-right',
    pageNumberAlignment: footerAlignment,
  });

  doc.addSection({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        margin: pageMargin,
        size: {
          width: Math.round(pageSize.width * 20),
          height: Math.round(pageSize.height * 20)
        },
      },
      column: columnLayout === 2
        ? {
            count: 2,
            equalWidth: true,
            space: 708,
          }
        : undefined,
    },
    headers: header ? { default: header } : undefined,
    footers: footer ? { default: footer } : undefined,
    children
  });

  if (appendixChildren.length > 0) {
    doc.addSection({
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: pageMargin,
          size: {
            width: Math.round(pageSize.width * 20),
            height: Math.round(pageSize.height * 20)
          }
        },
        column: {
          count: 1,
          equalWidth: true,
        }
      },
      headers: header ? { default: header } : undefined,
      footers: footer ? { default: footer } : undefined,
      children: appendixChildren
    });
  }

  return Packer.toBuffer(doc);
}

function loadDocx(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = eval('require') as (m: string) => any;
    return req('docx');
  } catch (error) {
    throw new Error('DOCX_NOT_AVAILABLE');
  }
}

function cmToTwips(cm: number): number {
  return Math.round(cm * 1440 / 2.54);
}

function resolvePageSize(size?: 'A4' | 'LETTER' | 'A5'): { width: number; height: number } {
  if (size === 'LETTER') {
    return { width: 612, height: 792 };
  }
  if (size === 'A5') {
    return { width: 419.53, height: 595.28 };
  }
  return { width: 595.28, height: 841.89 };
}

function splitIntoParagraphs(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];
  return normalized.split(/\n{2,}/).map(block => block.replace(/\n+/g, ' ').trim()).filter(Boolean);
}

function splitBibliography(bibliography: string): string[] {
  return bibliography
    .split(/\n{2,}/)
    .map(entry => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function buildFigureImageRun(params: {
  ImageRun: any;
  asset?: { fileName: string; buffer: Buffer };
  availablePageWidthTwips: number;
}) {
  if (!params.asset) {
    return null;
  }

  const lowerName = params.asset.fileName.toLowerCase();
  if (lowerName.endsWith('.svg')) {
    return null;
  }

  let width = 480;
  let height = 360;
  const dimensions = getImageDimensions(params.asset.buffer);
  if (dimensions?.width && dimensions?.height) {
    width = dimensions.width;
    height = dimensions.height;

    const maxWidth = Math.max(240, Math.floor((params.availablePageWidthTwips / 1440) * 96));
    if (width > maxWidth) {
      const ratio = maxWidth / width;
      width = maxWidth;
      height = Math.max(1, Math.round(height * ratio));
    }

    const maxHeight = 640;
    if (height > maxHeight) {
      const ratio = maxHeight / height;
      height = maxHeight;
      width = Math.max(1, Math.round(width * ratio));
    }
  }

  return new params.ImageRun({
    data: params.asset.buffer,
    transformation: { width, height },
  });
}

function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = eval('require') as (moduleName: string) => any;
    const imageSize = req('image-size').default || req('image-size');
    const dimensions = imageSize(buffer);
    if (!dimensions?.width || !dimensions?.height) {
      return null;
    }

    return {
      width: Number(dimensions.width),
      height: Number(dimensions.height),
    };
  } catch {
    return null;
  }
}

function buildHeaderFooter(params: {
  HeaderOrFooter: any;
  Paragraph: any;
  TextRun: any;
  AlignmentType: any;
  PageNumber: any;
  text?: string;
  includePageNumbers: boolean;
  pageNumberAlignment: any;
}) {
  const { HeaderOrFooter, Paragraph, TextRun, AlignmentType, PageNumber } = params;
  const children: any[] = [];

  if (params.text && params.text.trim()) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: params.text.trim(),
          }),
        ],
        alignment: AlignmentType.LEFT,
      }),
    );
  }

  if (params.includePageNumbers) {
    children.push(
      new Paragraph({
        children: [PageNumber.CURRENT],
        alignment: params.pageNumberAlignment,
      }),
    );
  }

  if (children.length === 0) {
    return undefined;
  }

  return new HeaderOrFooter({ children });
}
