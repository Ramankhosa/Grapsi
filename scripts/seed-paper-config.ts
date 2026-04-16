#!/usr/bin/env npx ts-node

/**
 * Seed Script for Paper Configuration
 * 
 * Seeds:
 * - Paper Types (Journal Article, Conference Paper, etc.)
 * - Citation Styles (APA7, IEEE, Chicago, MLA, Harvard)
 * - Publication Venues (Nature, IEEE, ACM, etc.)
 * 
 * Usage: npx tsx scripts/seed-paper-config.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ========================================
// PAPER TYPES
// ========================================
const PAPER_TYPES = [
  {
    code: 'JOURNAL_ARTICLE',
    name: 'Journal Article',
    description: 'Original research published in academic journals. Standard format for peer-reviewed scientific publications.',
    requiredSections: ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion', 'references'],
    optionalSections: ['literature_review', 'acknowledgments', 'appendix', 'supplementary'],
    sectionOrder: ['abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'acknowledgments', 'references', 'appendix', 'supplementary'],
    defaultWordLimits: {
      abstract: 300,
      introduction: 1000,
      literature_review: 2000,
      methodology: 1500,
      results: 2000,
      discussion: 2000,
      conclusion: 500,
      acknowledgments: 200,
      references: null,
      appendix: null,
      supplementary: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 1
  },
  {
    code: 'CONFERENCE_PAPER',
    name: 'Conference Paper',
    description: 'Research presented at academic conferences. Usually more concise with strict page limits.',
    requiredSections: ['abstract', 'introduction', 'related_work', 'methodology', 'experiments', 'conclusion', 'references'],
    optionalSections: ['acknowledgments', 'appendix'],
    sectionOrder: ['abstract', 'introduction', 'related_work', 'methodology', 'experiments', 'conclusion', 'acknowledgments', 'references', 'appendix'],
    defaultWordLimits: {
      abstract: 200,
      introduction: 800,
      related_work: 1000,
      methodology: 1200,
      experiments: 1500,
      conclusion: 400,
      acknowledgments: 100,
      references: null,
      appendix: null
    },
    defaultCitationStyle: 'IEEE',
    sortOrder: 2
  },
  {
    code: 'REVIEW_ARTICLE',
    name: 'Review Article',
    description: 'Comprehensive analysis and synthesis of existing research on a specific topic.',
    requiredSections: ['abstract', 'introduction', 'methodology', 'literature_analysis', 'discussion', 'conclusion', 'references'],
    optionalSections: ['acknowledgments', 'appendix', 'supplementary'],
    sectionOrder: ['abstract', 'introduction', 'methodology', 'literature_analysis', 'discussion', 'conclusion', 'acknowledgments', 'references', 'appendix', 'supplementary'],
    defaultWordLimits: {
      abstract: 350,
      introduction: 1500,
      methodology: 1000,
      literature_analysis: 5000,
      discussion: 2500,
      conclusion: 800,
      acknowledgments: 200,
      references: null,
      appendix: null,
      supplementary: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 3
  },
  {
    code: 'THESIS_PHD',
    name: 'PhD Thesis',
    description: 'Doctoral dissertation with extensive original research contribution.',
    requiredSections: ['abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'references'],
    optionalSections: ['acknowledgments', 'dedication', 'list_of_figures', 'list_of_tables', 'appendix', 'glossary'],
    sectionOrder: ['dedication', 'acknowledgments', 'abstract', 'list_of_figures', 'list_of_tables', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'references', 'glossary', 'appendix'],
    defaultWordLimits: {
      abstract: 500,
      introduction: 5000,
      literature_review: 15000,
      methodology: 10000,
      results: 15000,
      discussion: 10000,
      conclusion: 3000,
      acknowledgments: 500,
      dedication: 200,
      list_of_figures: null,
      list_of_tables: null,
      references: null,
      glossary: null,
      appendix: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 4
  },
  {
    code: 'THESIS_MASTERS',
    name: 'Masters Thesis',
    description: 'Graduate-level thesis demonstrating research competency.',
    requiredSections: ['abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'references'],
    optionalSections: ['acknowledgments', 'appendix', 'glossary'],
    sectionOrder: ['acknowledgments', 'abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'references', 'glossary', 'appendix'],
    defaultWordLimits: {
      abstract: 350,
      introduction: 3000,
      literature_review: 8000,
      methodology: 5000,
      results: 8000,
      discussion: 5000,
      conclusion: 2000,
      acknowledgments: 300,
      references: null,
      glossary: null,
      appendix: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 5
  },
  {
    code: 'CASE_STUDY',
    name: 'Case Study',
    description: 'In-depth analysis of specific cases or examples in professional or academic contexts.',
    requiredSections: ['abstract', 'introduction', 'case_description', 'analysis', 'discussion', 'conclusion', 'references'],
    optionalSections: ['acknowledgments', 'appendix'],
    sectionOrder: ['abstract', 'introduction', 'case_description', 'analysis', 'discussion', 'conclusion', 'acknowledgments', 'references', 'appendix'],
    defaultWordLimits: {
      abstract: 200,
      introduction: 600,
      case_description: 1500,
      analysis: 1500,
      discussion: 1000,
      conclusion: 400,
      acknowledgments: 100,
      references: null,
      appendix: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 6
  },
  {
    code: 'TECHNICAL_REPORT',
    name: 'Technical Report',
    description: 'Detailed technical documentation of research, experiments, or project outcomes.',
    requiredSections: ['executive_summary', 'introduction', 'technical_background', 'methodology', 'findings', 'recommendations', 'references'],
    optionalSections: ['acknowledgments', 'appendix', 'glossary'],
    sectionOrder: ['executive_summary', 'introduction', 'technical_background', 'methodology', 'findings', 'recommendations', 'acknowledgments', 'references', 'glossary', 'appendix'],
    defaultWordLimits: {
      executive_summary: 500,
      introduction: 800,
      technical_background: 2000,
      methodology: 2000,
      findings: 3000,
      recommendations: 1000,
      acknowledgments: 200,
      references: null,
      glossary: null,
      appendix: null
    },
    defaultCitationStyle: 'IEEE',
    sortOrder: 7
  },
  {
    code: 'WHITE_PAPER',
    name: 'White Paper',
    description: 'Authoritative guide explaining complex issues and presenting solutions or best practices.',
    requiredSections: ['executive_summary', 'introduction', 'problem_statement', 'solution', 'benefits', 'conclusion'],
    optionalSections: ['case_studies', 'references', 'about_author'],
    sectionOrder: ['executive_summary', 'introduction', 'problem_statement', 'solution', 'benefits', 'case_studies', 'conclusion', 'about_author', 'references'],
    defaultWordLimits: {
      executive_summary: 300,
      introduction: 500,
      problem_statement: 1000,
      solution: 2000,
      benefits: 1000,
      case_studies: 1500,
      conclusion: 400,
      about_author: 200,
      references: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 8
  },
  {
    code: 'BOOK_CHAPTER',
    name: 'Book Chapter',
    description: 'Scholarly contribution to an edited volume or textbook. Emphasizes depth, conceptual clarity, and pedagogical value over novelty.',
    requiredSections: ['abstract', 'introduction', 'literature_review', 'main_content', 'discussion', 'conclusion', 'references'],
    optionalSections: ['methodology', 'case_studies', 'acknowledgments', 'further_reading', 'appendix'],
    sectionOrder: ['abstract', 'introduction', 'literature_review', 'methodology', 'main_content', 'case_studies', 'discussion', 'conclusion', 'acknowledgments', 'references', 'further_reading', 'appendix'],
    defaultWordLimits: {
      abstract: 300,
      introduction: 2500,
      literature_review: 4000,
      methodology: 3000,
      main_content: 6000,
      case_studies: 3000,
      discussion: 2500,
      conclusion: 800,
      acknowledgments: 200,
      references: null,
      further_reading: null,
      appendix: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 9
  },
  {
    code: 'SHORT_COMMUNICATION',
    name: 'Short Communication',
    description: 'Brief report of significant findings, typically with strict length limits.',
    requiredSections: ['abstract', 'introduction', 'methodology', 'results', 'conclusion', 'references'],
    optionalSections: ['acknowledgments'],
    sectionOrder: ['abstract', 'introduction', 'methodology', 'results', 'conclusion', 'acknowledgments', 'references'],
    defaultWordLimits: {
      abstract: 150,
      introduction: 400,
      methodology: 400,
      results: 600,
      conclusion: 300,
      acknowledgments: 50,
      references: null
    },
    defaultCitationStyle: 'APA7',
    sortOrder: 10
  }
]

// ========================================
// CITATION STYLES
// ========================================
const CITATION_STYLES = [
  {
    code: 'APA7',
    name: 'APA 7th Edition',
    inTextFormatTemplate: '(Author, Year)',
    bibliographyRules: {
      journal: {
        format: 'Author, A. A., & Author, B. B. (Year). Title of article. Title of Periodical, volume(issue), pages. https://doi.org/xxxxx',
        italicize: ['Title of Periodical'],
        required: ['author', 'year', 'title', 'journal', 'volume']
      },
      book: {
        format: 'Author, A. A. (Year). Title of work: Capital letter also for subtitle. Publisher.',
        italicize: ['Title of work'],
        required: ['author', 'year', 'title', 'publisher']
      },
      website: {
        format: 'Author, A. A. (Year, Month Day). Title of page. Site Name. URL',
        required: ['title', 'url']
      },
      conference: {
        format: 'Author, A. A. (Year, Month Day–Day). Title of paper [Paper presentation]. Name of Conference, Location.',
        required: ['author', 'year', 'title', 'conference']
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 20,
    sortOrder: 1
  },
  {
    code: 'IEEE',
    name: 'IEEE',
    inTextFormatTemplate: '[n]',
    bibliographyRules: {
      journal: {
        format: 'A. A. Author and B. B. Author, "Title of article," Title of Journal, vol. x, no. x, pp. xxx-xxx, Month Year.',
        italicize: ['Title of Journal'],
        required: ['author', 'title', 'journal', 'volume', 'year']
      },
      book: {
        format: 'A. A. Author, Title of Book. City, Country: Publisher, Year.',
        italicize: ['Title of Book'],
        required: ['author', 'title', 'publisher', 'year']
      },
      conference: {
        format: 'A. A. Author, "Title of paper," in Proc. Conf. Name, City, Country, Year, pp. xxx-xxx.',
        required: ['author', 'title', 'conference', 'year']
      },
      website: {
        format: 'A. A. Author. "Title of page." Webpage. URL (accessed Month Day, Year).',
        required: ['title', 'url']
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 6,
    sortOrder: 2
  },
  {
    code: 'CHICAGO',
    name: 'Chicago Manual of Style',
    inTextFormatTemplate: '(Author Year, page)',
    bibliographyRules: {
      journal: {
        format: 'Last, First M., and First M. Last. "Article Title." Journal Title Volume, no. Issue (Year): pages.',
        italicize: ['Journal Title'],
        required: ['author', 'title', 'journal', 'volume', 'year']
      },
      book: {
        format: 'Last, First M. Title of Book. Place of Publication: Publisher, Year.',
        italicize: ['Title of Book'],
        required: ['author', 'title', 'publisher', 'year']
      },
      website: {
        format: 'Last, First M. "Page Title." Website Name. Published/Modified date. URL.',
        required: ['title', 'url']
      },
      chapter: {
        format: 'Last, First M. "Chapter Title." In Book Title, edited by First Last, pages. Place: Publisher, Year.',
        italicize: ['Book Title'],
        required: ['author', 'title', 'book', 'editor', 'publisher', 'year']
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: true,
    maxAuthorsBeforeEtAl: 10,
    sortOrder: 3
  },
  {
    code: 'MLA9',
    name: 'MLA 9th Edition',
    inTextFormatTemplate: '(Author page)',
    bibliographyRules: {
      journal: {
        format: 'Last, First. "Article Title." Journal Title, vol. x, no. x, Year, pp. xx-xx.',
        italicize: ['Journal Title'],
        required: ['author', 'title', 'journal', 'year']
      },
      book: {
        format: 'Last, First. Title of Book. Publisher, Year.',
        italicize: ['Title of Book'],
        required: ['author', 'title', 'publisher', 'year']
      },
      website: {
        format: 'Author. "Page Title." Website Name, Publisher, Day Month Year, URL.',
        italicize: ['Website Name'],
        required: ['title', 'url']
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 4
  },
  {
    code: 'HARVARD',
    name: 'Harvard Referencing',
    inTextFormatTemplate: '(Author Year)',
    bibliographyRules: {
      journal: {
        format: 'Author, A.A. and Author, B.B. (Year) \'Title of article\', Journal Title, Volume(Issue), pp. xx-xx.',
        italicize: ['Journal Title'],
        required: ['author', 'year', 'title', 'journal']
      },
      book: {
        format: 'Author, A.A. (Year) Title of book. Edition. Place of publication: Publisher.',
        italicize: ['Title of book'],
        required: ['author', 'year', 'title', 'publisher']
      },
      website: {
        format: 'Author (Year) Title of web page. Available at: URL (Accessed: Day Month Year).',
        required: ['title', 'url']
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 5
  },
  {
    code: 'VANCOUVER',
    name: 'Vancouver',
    inTextFormatTemplate: '(n)',
    bibliographyRules: {
      journal: {
        format: 'Author AA, Author BB. Title of article. Journal Name. Year;Volume(Issue):pages.',
        required: ['author', 'title', 'journal', 'year', 'volume']
      },
      book: {
        format: 'Author AA. Title of book. Edition. Place of publication: Publisher; Year.',
        required: ['author', 'title', 'publisher', 'year']
      },
      website: {
        format: 'Title of page [Internet]. Site name. Year [cited date]. Available from: URL',
        required: ['title', 'url']
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 6,
    sortOrder: 6
  }
]

// ========================================
// PUBLICATION VENUES
// Ranking: 1=Top tier (Q1/A*), 2=High (Q2/A), 3=Good (Q3/B), 4=Standard (Q4/C)
// ========================================
const PUBLICATION_VENUES = [
  // === TOP MULTIDISCIPLINARY JOURNALS ===
  {
    code: 'NATURE',
    name: 'Nature',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    wordLimitOverrides: { abstract: 150, introduction: 500 },
    formattingGuidelines: 'https://www.nature.com/nature/for-authors',
    impactFactor: 64.8,
    ranking: 1,
    website: 'https://www.nature.com',
    submissionUrl: 'https://mts-nature.nature.com',
    sortOrder: 1
  },
  {
    code: 'SCIENCE',
    name: 'Science',
    venueType: 'JOURNAL',
    citationStyleCode: 'CHICAGO',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    wordLimitOverrides: { abstract: 125 },
    formattingGuidelines: 'https://www.science.org/content/page/instructions-preparing-initial-manuscript',
    impactFactor: 56.9,
    ranking: 1,
    website: 'https://www.science.org',
    sortOrder: 2
  },
  {
    code: 'PNAS',
    name: 'PNAS (Proceedings of the National Academy of Sciences)',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    wordLimitOverrides: { abstract: 250 },
    formattingGuidelines: 'https://www.pnas.org/author-center',
    impactFactor: 11.1,
    ranking: 1,
    website: 'https://www.pnas.org',
    sortOrder: 3
  },
  
  // === COMPUTER SCIENCE ===
  {
    code: 'IEEE_TPAMI',
    name: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
    venueType: 'JOURNAL',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    formattingGuidelines: 'https://www.computer.org/csdl/journal/tp/write-for-us/15002',
    impactFactor: 23.6,
    ranking: 1,
    website: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=34',
    sortOrder: 10
  },
  {
    code: 'ACM_COMPUTING_SURVEYS',
    name: 'ACM Computing Surveys',
    venueType: 'JOURNAL',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['REVIEW_ARTICLE'],
    formattingGuidelines: 'https://dl.acm.org/journal/csur/author-guidelines',
    impactFactor: 16.6,
    ranking: 1,
    website: 'https://dl.acm.org/journal/csur',
    sortOrder: 11
  },
  {
    code: 'NEURIPS',
    name: 'NeurIPS (Neural Information Processing Systems)',
    venueType: 'CONFERENCE',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['CONFERENCE_PAPER'],
    wordLimitOverrides: { abstract: 200 },
    formattingGuidelines: 'https://neurips.cc/Conferences/2024/CallForPapers',
    ranking: 1,
    website: 'https://neurips.cc',
    sortOrder: 20
  },
  {
    code: 'ICML',
    name: 'ICML (International Conference on Machine Learning)',
    venueType: 'CONFERENCE',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['CONFERENCE_PAPER'],
    formattingGuidelines: 'https://icml.cc/Conferences/2024/CallForPapers',
    ranking: 1,
    website: 'https://icml.cc',
    sortOrder: 21
  },
  {
    code: 'CVPR',
    name: 'CVPR (Conference on Computer Vision and Pattern Recognition)',
    venueType: 'CONFERENCE',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['CONFERENCE_PAPER'],
    formattingGuidelines: 'https://cvpr.thecvf.com/Conferences/2024/AuthorGuidelines',
    ranking: 1,
    website: 'https://cvpr.thecvf.com',
    sortOrder: 22
  },
  {
    code: 'ACL',
    name: 'ACL (Association for Computational Linguistics)',
    venueType: 'CONFERENCE',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['CONFERENCE_PAPER'],
    formattingGuidelines: 'https://aclanthology.org/info/contrib/',
    ranking: 1,
    website: 'https://aclanthology.org',
    sortOrder: 23
  },

  // === LIFE SCIENCES / MEDICINE ===
  {
    code: 'CELL',
    name: 'Cell',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    formattingGuidelines: 'https://www.cell.com/cell/authors',
    impactFactor: 64.5,
    ranking: 1,
    website: 'https://www.cell.com/cell',
    sortOrder: 30
  },
  {
    code: 'LANCET',
    name: 'The Lancet',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE', 'CASE_STUDY'],
    wordLimitOverrides: { abstract: 300 },
    formattingGuidelines: 'https://www.thelancet.com/lancet/information-for-authors',
    impactFactor: 168.9,
    ranking: 1,
    website: 'https://www.thelancet.com',
    sortOrder: 31
  },
  {
    code: 'NEJM',
    name: 'New England Journal of Medicine',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE', 'CASE_STUDY'],
    formattingGuidelines: 'https://www.nejm.org/author-center/new-manuscripts',
    impactFactor: 176.1,
    ranking: 1,
    website: 'https://www.nejm.org',
    sortOrder: 32
  },

  // === SOCIAL SCIENCES ===
  {
    code: 'PSYCHOLOGICAL_REVIEW',
    name: 'Psychological Review',
    venueType: 'JOURNAL',
    citationStyleCode: 'APA7',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    formattingGuidelines: 'https://www.apa.org/pubs/journals/rev',
    impactFactor: 5.1,
    ranking: 1,
    website: 'https://www.apa.org/pubs/journals/rev',
    sortOrder: 40
  },
  {
    code: 'ACADEMY_MGMT_REVIEW',
    name: 'Academy of Management Review',
    venueType: 'JOURNAL',
    citationStyleCode: 'APA7',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE'],
    formattingGuidelines: 'https://journals.aom.org/journal/amr',
    impactFactor: 12.3,
    ranking: 1,
    website: 'https://journals.aom.org/journal/amr',
    sortOrder: 41
  },

  // === ENGINEERING ===
  {
    code: 'IEEE_TSE',
    name: 'IEEE Transactions on Software Engineering',
    venueType: 'JOURNAL',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    formattingGuidelines: 'https://www.computer.org/csdl/journal/ts/write-for-us/14927',
    impactFactor: 6.5,
    ranking: 1,
    website: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=32',
    sortOrder: 50
  },
  {
    code: 'IEEE_TKDE',
    name: 'IEEE Transactions on Knowledge and Data Engineering',
    venueType: 'JOURNAL',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    formattingGuidelines: 'https://www.computer.org/csdl/journal/tk/write-for-us/14904',
    impactFactor: 8.9,
    ranking: 1,
    website: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=69',
    sortOrder: 51
  },

  // === OPEN ACCESS ===
  {
    code: 'PLOS_ONE',
    name: 'PLOS ONE',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'REVIEW_ARTICLE', 'CASE_STUDY'],
    formattingGuidelines: 'https://journals.plos.org/plosone/s/submission-guidelines',
    impactFactor: 3.7,
    ranking: 2,
    website: 'https://journals.plos.org/plosone/',
    sortOrder: 60
  },
  {
    code: 'SCIENTIFIC_REPORTS',
    name: 'Scientific Reports',
    venueType: 'JOURNAL',
    citationStyleCode: 'VANCOUVER',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    formattingGuidelines: 'https://www.nature.com/srep/author-instructions',
    impactFactor: 4.6,
    ranking: 2,
    website: 'https://www.nature.com/srep/',
    sortOrder: 61
  },
  {
    code: 'ARXIV',
    name: 'arXiv',
    venueType: 'JOURNAL',
    citationStyleCode: 'IEEE',
    acceptedPaperTypes: ['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'TECHNICAL_REPORT'],
    formattingGuidelines: 'https://info.arxiv.org/help/submit/index.html',
    website: 'https://arxiv.org',
    sortOrder: 62
  }
]

async function seedPaperTypes() {
  console.log('\n📚 Seeding Paper Types...')
  
  for (const paperType of PAPER_TYPES) {
    await prisma.paperTypeDefinition.upsert({
      where: { code: paperType.code },
      update: {
        name: paperType.name,
        description: paperType.description,
        requiredSections: paperType.requiredSections,
        optionalSections: paperType.optionalSections,
        sectionOrder: paperType.sectionOrder,
        defaultWordLimits: paperType.defaultWordLimits,
        defaultCitationStyle: paperType.defaultCitationStyle,
        sortOrder: paperType.sortOrder,
        isActive: true
      },
      create: {
        code: paperType.code,
        name: paperType.name,
        description: paperType.description,
        requiredSections: paperType.requiredSections,
        optionalSections: paperType.optionalSections,
        sectionOrder: paperType.sectionOrder,
        defaultWordLimits: paperType.defaultWordLimits,
        defaultCitationStyle: paperType.defaultCitationStyle,
        sortOrder: paperType.sortOrder,
        isActive: true
      }
    })
    console.log(`  ✅ ${paperType.name}`)
  }
  
  console.log(`📚 Seeded ${PAPER_TYPES.length} paper types`)
}

async function seedCitationStyles() {
  console.log('\n📖 Seeding Citation Styles...')
  
  for (const style of CITATION_STYLES) {
    await prisma.citationStyleDefinition.upsert({
      where: { code: style.code },
      update: {
        name: style.name,
        inTextFormatTemplate: style.inTextFormatTemplate,
        bibliographyRules: style.bibliographyRules,
        bibliographySortOrder: style.bibliographySortOrder,
        supportsShortTitles: style.supportsShortTitles,
        maxAuthorsBeforeEtAl: style.maxAuthorsBeforeEtAl,
        sortOrder: style.sortOrder,
        isActive: true
      },
      create: {
        code: style.code,
        name: style.name,
        inTextFormatTemplate: style.inTextFormatTemplate,
        bibliographyRules: style.bibliographyRules,
        bibliographySortOrder: style.bibliographySortOrder,
        supportsShortTitles: style.supportsShortTitles,
        maxAuthorsBeforeEtAl: style.maxAuthorsBeforeEtAl,
        sortOrder: style.sortOrder,
        isActive: true
      }
    })
    console.log(`  ✅ ${style.name}`)
  }
  
  console.log(`📖 Seeded ${CITATION_STYLES.length} citation styles`)
}

async function seedPublicationVenues() {
  console.log('\n🏛️ Seeding Publication Venues...')
  
  // First, get all citation styles for lookup
  const citationStyles = await prisma.citationStyleDefinition.findMany()
  const styleByCode = Object.fromEntries(citationStyles.map(s => [s.code, s.id]))
  
  for (const venue of PUBLICATION_VENUES) {
    const citationStyleId = styleByCode[venue.citationStyleCode]
    if (!citationStyleId) {
      console.log(`  ⚠️ Skipping ${venue.name} - citation style ${venue.citationStyleCode} not found`)
      continue
    }
    
    await prisma.publicationVenue.upsert({
      where: { code: venue.code },
      update: {
        name: venue.name,
        venueType: venue.venueType as any,
        citationStyleId: citationStyleId,
        acceptedPaperTypes: venue.acceptedPaperTypes,
        wordLimitOverrides: venue.wordLimitOverrides || undefined,
        formattingGuidelines: venue.formattingGuidelines || undefined,
        impactFactor: venue.impactFactor || null,
        ranking: venue.ranking || null,
        website: venue.website || null,
        submissionUrl: venue.submissionUrl || null,
        sortOrder: venue.sortOrder,
        isActive: true
      },
      create: {
        code: venue.code,
        name: venue.name,
        venueType: venue.venueType as any,
        citationStyleId: citationStyleId,
        acceptedPaperTypes: venue.acceptedPaperTypes,
        wordLimitOverrides: venue.wordLimitOverrides || undefined,
        formattingGuidelines: venue.formattingGuidelines || undefined,
        impactFactor: venue.impactFactor || null,
        ranking: venue.ranking || null,
        website: venue.website || null,
        submissionUrl: venue.submissionUrl || null,
        sortOrder: venue.sortOrder,
        isActive: true
      }
    })
    console.log(`  ✅ ${venue.name}`)
  }
  
  console.log(`🏛️ Seeded ${PUBLICATION_VENUES.length} publication venues`)
}

async function main() {
  console.log('🚀 Starting Paper Configuration Seed...')
  console.log('==========================================')
  
  try {
    await seedPaperTypes()
    await seedCitationStyles()
    await seedPublicationVenues()
    
    console.log('\n==========================================')
    console.log('✨ Paper Configuration Seeding Complete!')
    console.log(`   - ${PAPER_TYPES.length} Paper Types`)
    console.log(`   - ${CITATION_STYLES.length} Citation Styles`)
    console.log(`   - ${PUBLICATION_VENUES.length} Publication Venues`)
  } catch (error) {
    console.error('❌ Error during seeding:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()

