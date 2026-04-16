const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const publicationVenues = [
  {
    id: 'venue_nature',
    code: 'NATURE',
    name: 'Nature',
    venueType: 'JOURNAL',
    citationStyleId: 'citation_style_apa7', // Will be updated when Nature style is added
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    sectionOverrides: {
      required: ["abstract", "introduction", "results", "discussion", "methods", "references"],
      optional: ["acknowledgments"]
    },
    wordLimitOverrides: {
      abstract: 150,
      introduction: 500,
      results: 1000,
      discussion: 1000,
      methods: 2000
    },
    formattingGuidelines: {
      font: "Times New Roman",
      fontSize: 12,
      lineSpacing: 1.5,
      margins: "1 inch",
      maxFigures: 6,
      maxReferences: 50
    },
    impactFactor: 49.962,
    website: 'https://www.nature.com/',
    sortOrder: 1
  },
  {
    id: 'venue_science',
    code: 'SCIENCE',
    name: 'Science',
    venueType: 'JOURNAL',
    citationStyleId: 'citation_style_apa7',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    sectionOverrides: {
      required: ["abstract", "introduction", "results", "discussion", "methods", "references"],
      optional: ["acknowledgments"]
    },
    wordLimitOverrides: {
      abstract: 150,
      introduction: 600,
      results: 1200,
      discussion: 1200,
      methods: 2500
    },
    formattingGuidelines: {
      font: "Times New Roman",
      fontSize: 12,
      lineSpacing: 1.5,
      margins: "1 inch",
      maxFigures: 8,
      maxReferences: 50
    },
    impactFactor: 47.728,
    website: 'https://www.science.org/',
    sortOrder: 2
  },
  {
    id: 'venue_ieee_tse',
    code: 'IEEE_TSE',
    name: 'IEEE Transactions on Software Engineering',
    venueType: 'JOURNAL',
    citationStyleId: 'citation_style_ieee',
    acceptedPaperTypes: ['JOURNAL_ARTICLE'],
    sectionOverrides: {
      required: ["abstract", "introduction", "related_work", "methodology", "results", "discussion", "conclusion", "references"],
      optional: ["acknowledgments", "appendix"]
    },
    wordLimitOverrides: {
      abstract: 200,
      introduction: 1000,
      related_work: 800,
      methodology: 1500,
      results: 1000,
      discussion: 1200,
      conclusion: 500
    },
    formattingGuidelines: {
      font: "Times New Roman",
      fontSize: 10,
      lineSpacing: 1.0,
      margins: "1 inch",
      columns: 2,
      maxPages: 15,
      maxReferences: 40
    },
    impactFactor: 9.522,
    website: 'https://www.computer.org/csdl/journal/ts',
    sortOrder: 3
  }
];

async function seedPublicationVenues() {
  try {
    console.log('Seeding publication venues...');

    for (const venue of publicationVenues) {
      await prisma.publicationVenue.upsert({
        where: { code: venue.code },
        update: venue,
        create: venue
      });
      console.log(`✓ Seeded ${venue.code}: ${venue.name}`);
    }

    console.log('Publication venue seeding completed!');
  } catch (error) {
    console.error('Error seeding publication venues:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedPublicationVenues();
