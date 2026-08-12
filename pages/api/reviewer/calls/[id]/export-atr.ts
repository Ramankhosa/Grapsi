// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getSession, requireReviewerCallAccess } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { compareSections } from '@/lib/reviewer/sectionGrouping';
import { resolveSectionVersions } from '@/lib/reviewer/finalReport';
import { ensureCurrentReport } from '@/lib/reviewer/reportGeneration';
import { 
  Document, 
  Packer, 
  Paragraph, 
  HeadingLevel, 
  Table, 
  TableRow, 
  TableCell, 
  BorderStyle, 
  WidthType, 
  AlignmentType, 
  TextRun,
  ShadingType,
  PageOrientation
} from "docx";

// Define types for the review JSON structure
interface ReviewJson {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions?: string[];
  recommendations?: string[];
}

interface OverallReviewJson {
  overall_score: number;
  executive_summary: string;
  major_strengths: string[];
  major_weaknesses: string[];
  cross_sectional_recommendations: string[];
  funding_recommendation?: { decision: string; competitiveness: string; rationale: string } | null;
  compliance?: {
    requiredSections?: { covered: string[]; missing: string[]; coveragePercent: number };
    limits?: Array<{ section: string; limit: number; unit: string; actual: number; status: string }>;
    deadline?: { date: string | null; daysRemaining: number | null; status: string };
  } | null;
  priority_actions?: Array<{
    rank: number;
    section: string;
    action: string;
    impact: string;
    effort: string;
  }>;
  // The panel-quality blocks. These existed on screen but were dropped on the
  // way into the document, so the deliverable was a weaker artefact than the
  // page it was exported from.
  criterion_scorecard?: Array<{
    criterion: string;
    weight: number | null;
    score: number | null;
    verdict?: string;
    evidence_sections?: string[];
  }>;
  section_scorecard?: Array<{
    section: string;
    score: number | null;
    verdict?: string;
    headline?: string;
  }>;
  consistency_flags?: Array<{
    issue: string;
    sections?: string[];
    severity?: string;
  }>;
}

const DECISION_LABELS: Record<string, string> = {
  fund: 'Fund',
  fund_with_revisions: 'Fund with revisions',
  revise_and_resubmit: 'Revise and resubmit',
  do_not_fund: 'Do not fund',
};

const COMPETITIVENESS_LABELS: Record<string, string> = {
  top_tier: 'Top tier',
  competitive: 'Competitive',
  borderline: 'Borderline',
  not_competitive: 'Not competitive',
};

// Global Style Configuration
const Styles = {
  font: "Calibri",
  fontSize: 24, // 12pt
  paragraphSpacing: 100,
  heading1: { 
    size: 32, 
    bold: true, 
    spacing: { before: 300, after: 150 },
    color: "1F4E79" // Deep blue color for main headings
  },
  heading2: { 
    size: 28, 
    bold: true, 
    spacing: { before: 200, after: 100 },
    color: "2E75B6" // Medium blue color for subheadings
  },
  table: {
    headerFill: "D0E2F5", // Light blue header background
    altRowFill: "F5F9FC", // Very light blue for alternating rows
    cellPadding: 100,
    borderSize: 1,
    borderColor: "B4C6E7" // Light blue border color
  }
};

/** A level-2 heading in the document's own type scale. */
function sectionHeading(text: string) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: Styles.heading2.size,
        color: Styles.heading2.color,
      }),
    ],
    heading: HeadingLevel.HEADING_2,
    spacing: Styles.heading2.spacing,
  });
}

/**
 * A bordered table with a shaded header row, matching the ATR's existing
 * tables. `widths` are percentages and must line up with `headers`.
 */
function simpleTable(headers: string[], widths: number[], rows: string[][]) {
  const border = { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((header, index) => new TableCell({
          width: { size: widths[index] || Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
          shading: { fill: Styles.table.headerFill, type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              children: [new TextRun({ text: header, bold: true })],
              alignment: AlignmentType.CENTER,
            }),
          ],
        })),
      }),
      ...rows.map((cells, rowIndex) => new TableRow({
        children: cells.map((cell, index) => new TableCell({
          width: { size: widths[index] || Math.floor(100 / headers.length), type: WidthType.PERCENTAGE },
          shading: rowIndex % 2 === 1
            ? { fill: Styles.table.altRowFill, type: ShadingType.CLEAR }
            : undefined,
          // An empty cell collapses the row height in Word, so blanks become a
          // space rather than nothing.
          children: [new Paragraph(cell || ' ')],
        })),
      })),
    ],
  });
}

// Generate ATR Word document
async function generateATRDocument(
  projectTitle: string,
  overallReview: OverallReviewJson,
  sections: Array<{
    section_title: string,
    ai_review_json: ReviewJson
  }>,
  /** Set only when the report could not be brought up to date before export. */
  staleNotice?: string | null
): Promise<Buffer> {
  // Proposal order, shared with the workspace, the report and the auto-run.
  const sortedSections = [...sections].sort(compareSections);

  const children = [];

  if (staleNotice) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'OUT OF DATE — ', bold: true, color: "9C2C2C", size: 24 }),
          new TextRun({ text: staleNotice, color: "9C2C2C", size: 22 }),
        ],
        spacing: { before: 200, after: 200 },
        shading: { fill: "FDECEC", type: ShadingType.CLEAR },
      })
    );
  }

  // Title with subtle styling
  children.push(
    new Paragraph({
      text: "Action Taken Report (ATR)",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 240 },
      shading: {
        fill: "EBF1F9", // Very light blue background for title
        type: ShadingType.CLEAR,
      },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: projectTitle,
          bold: true,
          size: Styles.heading1.size,
          color: Styles.heading1.color,
        })
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Add overall rating with color
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Overall Rating: ${overallReview.overall_score.toFixed(1)}/10`,
          bold: true,
          color: "1F4E79", // Deep blue color
          size: 28,
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
    })
  );

  // Reviewer verdict, when the report carries one
  const fundingRecommendation = (overallReview as any).funding_recommendation;
  if (fundingRecommendation?.decision) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Reviewer verdict: ${DECISION_LABELS[fundingRecommendation.decision] || fundingRecommendation.decision}`,
            bold: true,
            size: 26,
            color: "1F4E79",
          }),
          new TextRun({
            text: `   (${COMPETITIVENESS_LABELS[fundingRecommendation.competitiveness] || fundingRecommendation.competitiveness})`,
            size: 22,
            color: "4A5568",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      })
    );
    if (fundingRecommendation.rationale) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: fundingRecommendation.rationale, size: 22, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
        })
      );
    }
  }

  // Compliance facts, which are counted rather than judged
  const compliance = (overallReview as any).compliance;
  if (compliance) {
    const complianceLines: string[] = [];
    if (compliance.requiredSections) {
      complianceLines.push(
        `Required sections drafted: ${compliance.requiredSections.coveragePercent}%${
          compliance.requiredSections.missing?.length
            ? ` — missing: ${compliance.requiredSections.missing.join('; ')}`
            : ''
        }`
      );
    }
    const breaches = (compliance.limits || []).filter((limit: any) => limit.status !== 'within');
    if (breaches.length > 0) {
      complianceLines.push(
        `Length limits: ${breaches
          .map((limit: any) => `${limit.section} at ${limit.actual} of ${limit.limit} ${limit.unit}`)
          .join('; ')}`
      );
    }
    if (compliance.deadline?.date) {
      complianceLines.push(
        `Deadline: ${String(compliance.deadline.date).slice(0, 10)}${
          compliance.deadline.status === 'passed'
            ? ' (passed)'
            : ` (${compliance.deadline.daysRemaining} days remaining)`
        }`
      );
    }

    for (const line of complianceLines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 80 },
        })
      );
    }
    if (complianceLines.length > 0) {
      children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    }
  }

  // Scorecards — the panel's actual marking, criterion by criterion and
  // section by section. Rendered before the action tables so a reader sees the
  // assessment before the remediation.
  const criterionScorecard = (overallReview as any).criterion_scorecard;
  if (Array.isArray(criterionScorecard) && criterionScorecard.length > 0) {
    children.push(sectionHeading("Criterion Scorecard"));
    children.push(
      simpleTable(
        ["Criterion", "Weight", "Score", "Verdict"],
        [30, 12, 12, 46],
        criterionScorecard.map((entry: any) => [
          String(entry?.criterion || ''),
          entry?.weight === null || entry?.weight === undefined ? '—' : String(entry.weight),
          // A criterion no section evidenced is scored null on purpose; printing
          // "0.0" would read as a failing mark rather than an absence.
          typeof entry?.score === 'number' ? entry.score.toFixed(1) : 'Not evidenced',
          [
            String(entry?.verdict || ''),
            Array.isArray(entry?.evidence_sections) && entry.evidence_sections.length > 0
              ? `(from ${entry.evidence_sections.join(', ')})`
              : '',
          ].filter(Boolean).join(' '),
        ])
      )
    );
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }

  const sectionScorecard = (overallReview as any).section_scorecard;
  if (Array.isArray(sectionScorecard) && sectionScorecard.length > 0) {
    children.push(sectionHeading("Section Scorecard"));
    children.push(
      simpleTable(
        ["Section", "Score", "Verdict", "What decides it"],
        [28, 12, 15, 45],
        sectionScorecard.map((entry: any) => [
          String(entry?.section || ''),
          typeof entry?.score === 'number' ? entry.score.toFixed(1) : '—',
          String(entry?.verdict || ''),
          String(entry?.headline || ''),
        ])
      )
    );
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }

  // Cross-section contradictions: the panel's distinctive contribution over the
  // per-section reviews, and the thing an applicant most needs in writing.
  const consistencyFlags = (overallReview as any).consistency_flags;
  if (Array.isArray(consistencyFlags) && consistencyFlags.length > 0) {
    children.push(sectionHeading("Cross-section Consistency Flags"));
    for (const flag of consistencyFlags) {
      const scope = Array.isArray(flag?.sections) && flag.sections.length > 0
        ? ` [${flag.sections.join(' ↔ ')}]`
        : '';
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${String(flag?.severity || 'medium').toUpperCase()}${scope}: `,
              bold: true,
              size: 22,
            }),
            new TextRun({ text: String(flag?.issue || ''), size: 22 }),
          ],
          bullet: { level: 0 },
          spacing: { after: 80 },
        })
      );
    }
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }

  // Introduction text with background
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "This Action Taken Report (ATR) documents the weaknesses identified during the grant review process and the corresponding recommendations to address them. Please fill in your remarks regarding the actions taken for each recommendation.",
          size: 24,
        })
      ],
      spacing: { before: 200, after: 200 },
      shading: {
        fill: "F5F9FC", // Very light blue background
        type: ShadingType.CLEAR,
      },
    })
  );

  // Ranked fixes, so the ATR opens with the highest-leverage work
  const priorityActions = (overallReview as any).priority_actions;
  if (Array.isArray(priorityActions) && priorityActions.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Priority Actions (highest impact first)",
            bold: true,
            size: Styles.heading2.size,
            color: Styles.heading2.color,
          })
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: Styles.heading2.spacing,
      })
    );

    for (const action of priorityActions) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${action.rank}. ${action.section ? `[${action.section}] ` : ''}${action.action}`,
              size: 24,
            }),
            new TextRun({
              text: `  (${action.impact} impact, ${action.effort} effort)`,
              size: 20,
              color: "6B7280",
            }),
          ],
          spacing: { after: 100 },
        })
      );
    }
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }

  // 1. Overall Weaknesses and Recommendations
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "1. Overall Weaknesses and Recommendations",
          bold: true,
          size: Styles.heading1.size,
          color: Styles.heading1.color,
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: Styles.heading1.spacing,
    })
  );

  // Create a table for overall weaknesses and recommendations
  if (overallReview.major_weaknesses.length > 0 || overallReview.cross_sectional_recommendations.length > 0) {
    // Combine all weaknesses into a single string
    const allWeaknesses = overallReview.major_weaknesses.map((weakness, i) => 
      `${i + 1}. ${weakness}`
    ).join('\n\n');
    
    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Major Weaknesses",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Recommendations",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Action Taken (Remarks)",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          })
        ]
      })
    ];

    // Create a row for each recommendation with the merged weaknesses cell
    const recommendations = overallReview.cross_sectional_recommendations;
    
    if (recommendations.length > 0) {
      recommendations.forEach((recommendation, i) => {
        // Ensure recommendation is a string
        const recommendationText = typeof recommendation === 'object' ? 
          JSON.stringify(recommendation) : String(recommendation).trim();
          
        // Add alternating row shading
        const shading = i % 2 === 1 ? { fill: Styles.table.altRowFill, type: ShadingType.CLEAR } : undefined;
          
        tableRows.push(
          new TableRow({
            children: [
              // Merge weaknesses cell for the first row only
              i === 0 ? 
              new TableCell({
                rowSpan: recommendations.length,
                verticalAlign: "top",
                shading: shading,
                children: allWeaknesses ? [new Paragraph(allWeaknesses)] : [new Paragraph(" ")]
              }) : 
              undefined,
              new TableCell({
                shading: shading,
                children: [new Paragraph(`${i + 1}. ${recommendationText}`)]
              }),
              new TableCell({
                shading: shading,
                children: [new Paragraph(" ")] // Empty space for remarks
              })
            ].filter(Boolean)
          })
        );
      });
    } else {
      // If there are no recommendations but there are weaknesses
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: allWeaknesses ? [new Paragraph(allWeaknesses)] : [new Paragraph(" ")]
            }),
            new TableCell({
              children: [new Paragraph("No specific recommendations provided.")]
            }),
            new TableCell({
              children: [new Paragraph(" ")] // Empty space for remarks
            })
          ]
        })
      );
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          bottom: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          left: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          right: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          insideHorizontal: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          insideVertical: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor }
        },
        rows: tableRows
      })
    );
  } else {
    children.push(
      new Paragraph({
        text: "No overall weaknesses or recommendations identified.",
        spacing: { before: 100, after: 100 },
      })
    );
  }

  // 2. Section-specific Weaknesses and Recommendations
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "2. Section-specific Weaknesses and Recommendations",
          bold: true,
          size: Styles.heading1.size,
          color: Styles.heading1.color,
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: Styles.heading1.spacing,
    })
  );

  // Loop through each section in the sorted order
  sortedSections.forEach((section, index) => {
    // Skip sections without weaknesses or recommendations
    if (!section.ai_review_json?.weaknesses?.length && 
        !section.ai_review_json?.recommendations?.length &&
        !section.ai_review_json?.suggestions?.length) {
      return;
    }

    // Add section heading with rating. The version is named whenever the
    // section has been revised, so a reader can tell which draft was scored.
    const sectionRating = section.ai_review_json?.score || 0;
    const sectionVersion = Number((section as any).version || 1);
    const versionLabel = sectionVersion > 1 ? ` — v${sectionVersion}` : '';
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `2.${index + 1}. ${section.section_title}${versionLabel} (Rating: ${sectionRating.toFixed(1)}/10)`,
            bold: true,
            size: Styles.heading2.size,
            color: Styles.heading2.color,
          })
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: Styles.heading2.spacing,
      })
    );

    // Combine all weaknesses for this section into a single string
    const weaknesses = section.ai_review_json?.weaknesses || [];
    const allWeaknesses = weaknesses.map((weakness, i) => 
      `${i + 1}. ${weakness}`
    ).join('\n\n');
    
    // For section recommendations, check both recommendations and suggestions arrays
    // Some sections might use suggestions instead of recommendations
    let recommendations = [];
    
    if (Array.isArray(section.ai_review_json?.recommendations) && section.ai_review_json?.recommendations.length > 0) {
      recommendations = section.ai_review_json.recommendations;
    } else if (Array.isArray(section.ai_review_json?.suggestions) && section.ai_review_json?.suggestions.length > 0) {
      recommendations = section.ai_review_json.suggestions;
    }
    
    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Weaknesses",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Recommendations",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: {
              fill: Styles.table.headerFill,
              type: ShadingType.CLEAR,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Action Taken (Remarks)",
                    bold: true,
                  })
                ],
                alignment: AlignmentType.CENTER,
              })
            ]
          })
        ]
      })
    ];

    // Add rows for each recommendation with merged weaknesses cell
    if (recommendations.length > 0) {
      recommendations.forEach((recommendation, i) => {
        // Ensure recommendation is a string
        const recommendationText = typeof recommendation === 'object' ? 
          JSON.stringify(recommendation) : String(recommendation).trim();
          
        // Add alternating row shading
        const shading = i % 2 === 1 ? { fill: Styles.table.altRowFill, type: ShadingType.CLEAR } : undefined;
        
        tableRows.push(
          new TableRow({
            children: [
              // Merge weaknesses cell for the first row only
              i === 0 ? 
              new TableCell({
                rowSpan: recommendations.length,
                verticalAlign: "top",
                shading: shading,
                children: allWeaknesses ? [new Paragraph(allWeaknesses)] : [new Paragraph(" ")]
              }) : 
              undefined,
              new TableCell({
                shading: shading,
                children: [new Paragraph(`${i + 1}. ${recommendationText}`)]
              }),
              new TableCell({
                shading: shading,
                children: [new Paragraph(" ")] // Empty space for remarks
              })
            ].filter(Boolean)
          })
        );
      });
    } else {
      // If there are no recommendations but there are weaknesses
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: allWeaknesses ? [new Paragraph(allWeaknesses)] : [new Paragraph(" ")]
            }),
            new TableCell({
              children: [new Paragraph("No specific recommendations provided.")]
            }),
            new TableCell({
              children: [new Paragraph(" ")] // Empty space for remarks
            })
          ]
        })
      );
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          bottom: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          left: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          right: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          insideHorizontal: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor },
          insideVertical: { style: BorderStyle.SINGLE, size: Styles.table.borderSize, color: Styles.table.borderColor }
        },
        rows: tableRows
      })
    );
  });

  // Create the document with styles and landscape orientation
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            orientation: PageOrientation.LANDSCAPE,
          },
        },
      },
      children: children,
    }],
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: {
            font: Styles.font,
            size: Styles.fontSize,
          },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          run: {
            font: Styles.font,
            size: 36,
            bold: true,
          },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          run: {
            font: Styles.font,
            size: Styles.heading1.size,
            bold: Styles.heading1.bold,
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          run: {
            font: Styles.font,
            size: Styles.heading2.size,
            bold: Styles.heading2.bold,
          },
        },
      ],
    },
  });

  // Generate buffer
  return await Packer.toBuffer(doc);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the id from the URL
  const { id } = req.query;
  
  // Check for valid ID
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid call ID' });
  }
  
  // Get the user session
  const session = await getSession({ req });
  
  // Check authentication
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // The same capability check every other reviewer route uses. This used to
    // compare `call.user_id` against the session user, which locked project
    // collaborators — people who can read and even run the review — out of the
    // export alone.
    const callAccess = await requireReviewerCallAccess(id, session, res, 'read');
    if (!callAccess) return;

    // The ATR is a deliverable, so it must describe the drafts as they stand.
    // This used to serve whatever was stored: revise a section and the
    // downloaded document still carried the previous verdict and score beside
    // the current section list, with nothing on the page saying so.
    const refresh = await ensureCurrentReport(id);

    // Get the reviewer call details
    const call = await prisma.reviewerCall.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
        project_title: true,
        overall_review_json: true,
        parsed_json: true,
      }
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (!call.overall_review_json || Object.keys(call.overall_review_json as object).length === 0) {
      return res.status(400).json({
        error: refresh.error
          || 'There is no panel report to export yet. Review at least one section, then generate the report.',
        code: 'REPORT_NOT_GENERATED',
      });
    }

    // Every draft ever submitted lives in this table, so filtering on
    // `status: 'reviewed'` alone printed a revised section once per version —
    // two "Objectives" headings, two different scores, no version labels. The
    // report and the workspace both resolve to one version per title; the
    // export has to agree with them.
    const allSections = await prisma.reviewerSection.findMany({
      where: { call_id: id },
      select: {
        id: true,
        section_title: true,
        version: true,
        status: true,
        ai_review_json: true,
      },
    });

    const scoredVersions = (call.overall_review_json as any)?.score_basis?.scoredVersions || null;
    const sections = resolveSectionVersions(allSections as any, scoredVersions)
      .effective
      .filter((section: any) => section.status === 'reviewed');

    // Ensure the overall review has the correct structure
    const defaultOverallReview: OverallReviewJson = {
      overall_score: 0,
      executive_summary: '',
      major_strengths: [],
      major_weaknesses: [],
      cross_sectional_recommendations: []
    };
    
    let overallReview = defaultOverallReview;
    
    // Parse the overall_review_json if it exists
    if (call.overall_review_json) {
      try {
        // Cast to any first to handle the type conversion
        const reviewJson = call.overall_review_json as any;
        
        overallReview = {
          overall_score: typeof reviewJson.overall_score === 'number' ? reviewJson.overall_score :
                      typeof reviewJson.overall_score === 'string' ? parseFloat(reviewJson.overall_score) : 0,
          executive_summary: typeof reviewJson.executive_summary === 'string' ? reviewJson.executive_summary : '',
          major_strengths: Array.isArray(reviewJson.major_strengths) ? reviewJson.major_strengths : [],
          major_weaknesses: Array.isArray(reviewJson.major_weaknesses) ? reviewJson.major_weaknesses : [],
          cross_sectional_recommendations: Array.isArray(reviewJson.cross_sectional_recommendations) ?
                                        reviewJson.cross_sectional_recommendations : [],
          // Carried through so the document can open with the verdict, the
          // computed compliance facts, and the ranked fixes. Reports generated
          // before these existed simply omit those blocks.
          funding_recommendation: reviewJson.funding_recommendation || null,
          compliance: reviewJson.compliance || null,
          priority_actions: Array.isArray(reviewJson.priority_actions) ? reviewJson.priority_actions : [],
        };
      } catch (e) {
        console.error('Error parsing overall review JSON:', e);
        overallReview = defaultOverallReview;
      }
    }

    // Process sections to ensure correct structure
    const processedSections = sections.map(section => {
      
      // Ensure ai_review_json has the correct structure
      const safeReviewJson: ReviewJson = {
        score: 0,
        summary: '',
        strengths: [],
        weaknesses: [],
        suggestions: [],
        recommendations: [],
        ...(section.ai_review_json as any || {})
      };
      
      // Ensure all arrays are actual arrays
      if (!Array.isArray(safeReviewJson.strengths)) safeReviewJson.strengths = [];
      if (!Array.isArray(safeReviewJson.weaknesses)) safeReviewJson.weaknesses = [];
      if (!Array.isArray(safeReviewJson.suggestions)) safeReviewJson.suggestions = [];
      if (!Array.isArray(safeReviewJson.recommendations)) safeReviewJson.recommendations = [];
      
      // Ensure all items in arrays are strings
      safeReviewJson.strengths = safeReviewJson.strengths.map(item => 
        typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
      safeReviewJson.weaknesses = safeReviewJson.weaknesses.map(item => 
        typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
      safeReviewJson.suggestions = safeReviewJson.suggestions.map(item => 
        typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
      safeReviewJson.recommendations = safeReviewJson.recommendations.map(item => 
        typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
      
      return {
        ...section,
        ai_review_json: safeReviewJson
      };
    });

    // Process overall review to ensure items are strings
    overallReview.major_strengths = overallReview.major_strengths.map(item => 
      typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
    overallReview.major_weaknesses = overallReview.major_weaknesses.map(item => 
      typeof item === 'object' ? JSON.stringify(item) : String(item).trim());
    overallReview.cross_sectional_recommendations = overallReview.cross_sectional_recommendations.map(item => 
      typeof item === 'object' ? JSON.stringify(item) : String(item).trim());

    // Only reachable when the refresh above could not run — a rate limit, or a
    // model failure. The document still ships, because a stale report beats no
    // report, but it has to say so on its own face: this file gets forwarded to
    // people who will never see the warning that was on the screen.
    const staleNotice = refresh.freshness === 'stale'
      ? 'This report was written before the latest revisions and does not describe the current drafts. Regenerate the panel report, then export again.'
      : null;

    // Generate the ATR document
    const projectTitle = call.project_title || "Untitled Project";
    const buffer = await generateATRDocument(
      projectTitle,
      overallReview,
      processedSections,
      staleNotice
    );

    // Set headers for downloading the Word document
    res.setHeader('Content-Disposition', `attachment; filename="ATR-${projectTitle.replace(/[^a-zA-Z0-9]/g, '_')}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    // Lets the client tell the user the export waited on a fresh report.
    res.setHeader('X-Reviewer-Report-Regenerated', refresh.regenerated ? '1' : '0');
    res.setHeader('X-Reviewer-Report-Freshness', refresh.freshness);
    res.send(buffer);
  } catch (error) {
    console.error('Error generating ATR document:', error);
    return res.status(500).json({ 
      error: 'Failed to generate ATR document',
      details: error.message
    });
  }
} 