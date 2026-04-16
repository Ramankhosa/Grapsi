const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const paperTypes = [
  {
    id: 'paper_type_journal_article',
    code: 'JOURNAL_ARTICLE',
    name: 'Journal Article',
    description: 'Traditional academic journal article with full research methodology',
    requiredSections: ["abstract", "introduction", "methodology", "results", "discussion", "conclusion"],
    optionalSections: ["literature_review", "acknowledgments", "references"],
    sectionOrder: ["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "acknowledgments", "references"],
    defaultWordLimits: { abstract: 250, introduction: 1000, literature_review: 1500, methodology: 1500, results: 1000, discussion: 1500, conclusion: 500 },
    defaultCitationStyle: 'APA7',
    sortOrder: 1
  },
  {
    id: 'paper_type_review_article',
    code: 'REVIEW_ARTICLE',
    name: 'Review Article',
    description: 'Comprehensive literature review and synthesis article',
    requiredSections: ["abstract", "introduction", "methodology", "literature_review", "discussion", "conclusion"],
    optionalSections: ["future_directions", "acknowledgments", "references"],
    sectionOrder: ["abstract", "introduction", "methodology", "literature_review", "discussion", "future_directions", "conclusion", "acknowledgments", "references"],
    defaultWordLimits: { abstract: 300, introduction: 800, methodology: 800, literature_review: 3000, discussion: 2000, future_directions: 800, conclusion: 600 },
    defaultCitationStyle: 'APA7',
    sortOrder: 2
  },
  {
    id: 'paper_type_conference_paper',
    code: 'CONFERENCE_PAPER',
    name: 'Conference Paper',
    description: 'Shorter format paper for academic conferences',
    requiredSections: ["abstract", "introduction", "related_work", "methodology", "results", "conclusion"],
    optionalSections: ["acknowledgments", "references"],
    sectionOrder: ["abstract", "introduction", "related_work", "methodology", "results", "discussion", "conclusion", "acknowledgments", "references"],
    defaultWordLimits: { abstract: 200, introduction: 800, related_work: 600, methodology: 1000, results: 800, discussion: 1000, conclusion: 400 },
    defaultCitationStyle: 'IEEE',
    sortOrder: 3
  },
  {
    id: 'paper_type_book_chapter',
    code: 'BOOK_CHAPTER',
    name: 'Book Chapter',
    description: 'Chapter contribution to an edited academic book',
    requiredSections: ["introduction", "main_content", "conclusion"],
    optionalSections: ["abstract", "literature_review", "case_studies", "references"],
    sectionOrder: ["abstract", "introduction", "literature_review", "main_content", "case_studies", "conclusion", "references"],
    defaultWordLimits: { abstract: 250, introduction: 1000, literature_review: 1200, main_content: 4000, case_studies: 2000, conclusion: 800 },
    defaultCitationStyle: 'APA7',
    sortOrder: 4
  },
  {
    id: 'paper_type_thesis_masters',
    code: 'THESIS_MASTERS',
    name: 'Master\'s Thesis',
    description: 'Master\'s level academic thesis',
    requiredSections: ["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion"],
    optionalSections: ["acknowledgments", "appendix", "publications", "references"],
    sectionOrder: ["abstract", "acknowledgments", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "appendix", "references"],
    defaultWordLimits: { abstract: 300, introduction: 2000, literature_review: 5000, methodology: 3000, results: 3000, discussion: 4000, conclusion: 1000 },
    defaultCitationStyle: 'APA7',
    sortOrder: 5
  },
  {
    id: 'paper_type_thesis_phd',
    code: 'THESIS_PHD',
    name: 'PhD Thesis',
    description: 'Doctoral level academic dissertation',
    requiredSections: ["abstract", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "future_work"],
    optionalSections: ["acknowledgments", "appendix", "publications", "references"],
    sectionOrder: ["abstract", "acknowledgments", "introduction", "literature_review", "methodology", "results", "discussion", "conclusion", "future_work", "appendix", "references"],
    defaultWordLimits: { abstract: 500, introduction: 3000, literature_review: 8000, methodology: 5000, results: 5000, discussion: 6000, conclusion: 1500, future_work: 2000 },
    defaultCitationStyle: 'APA7',
    sortOrder: 6
  },
  {
    id: 'paper_type_case_study',
    code: 'CASE_STUDY',
    name: 'Case Study',
    description: 'In-depth analysis of a specific case or phenomenon',
    requiredSections: ["abstract", "introduction", "case_description", "analysis", "discussion", "conclusion"],
    optionalSections: ["literature_review", "recommendations", "references"],
    sectionOrder: ["abstract", "introduction", "literature_review", "case_description", "analysis", "discussion", "recommendations", "conclusion", "references"],
    defaultWordLimits: { abstract: 200, introduction: 600, literature_review: 1000, case_description: 1500, analysis: 2000, discussion: 1500, recommendations: 800, conclusion: 500 },
    defaultCitationStyle: 'APA7',
    sortOrder: 7
  },
  {
    id: 'paper_type_short_communication',
    code: 'SHORT_COMMUNICATION',
    name: 'Short Communication',
    description: 'Brief research communication or letter to the editor',
    requiredSections: ["abstract", "introduction", "main_findings", "conclusion"],
    optionalSections: ["methodology", "references"],
    sectionOrder: ["abstract", "introduction", "methodology", "main_findings", "conclusion", "references"],
    defaultWordLimits: { abstract: 150, introduction: 400, methodology: 500, main_findings: 800, conclusion: 300 },
    defaultCitationStyle: 'APA7',
    sortOrder: 8
  }
];

async function seedPaperTypes() {
  try {
    console.log('Seeding paper type definitions...');

    for (const paperType of paperTypes) {
      await prisma.paperTypeDefinition.upsert({
        where: { code: paperType.code },
        update: paperType,
        create: paperType
      });
      console.log(`✓ Seeded ${paperType.code}: ${paperType.name}`);
    }

    console.log('Paper type seeding completed!');
  } catch (error) {
    console.error('Error seeding paper types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedPaperTypes();
