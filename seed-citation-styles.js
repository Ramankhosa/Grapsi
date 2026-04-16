const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const citationStyles = [
  {
    id: 'citation_style_apa7',
    code: 'APA7',
    name: 'APA 7th Edition',
    inTextFormatTemplate: '(Author, Year)',
    bibliographyRules: {
      journal: {
        template: 'AuthorLast, A. A., AuthorLast, B. B., & AuthorLast, C. C. (Year). Title of article. Title of Journal, volume(issue), page-page. DOI',
        authors: 'Last, First M.',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: 'AuthorLast, A. A. (Year). Title of book. Publisher.',
        authors: 'Last, First M.',
        title: 'title-case'
      },
      conference: {
        template: 'AuthorLast, A. A., AuthorLast, B. B., & AuthorLast, C. C. (Year, Month Day). Title of paper. In Proceedings of Conference Name (pp. page-page). Publisher. DOI',
        authors: 'Last, First M.',
        title: 'sentence-case'
      },
      website: {
        template: 'AuthorLast, A. A. (Year, Month Day). Title of page. Site Name. URL',
        authors: 'Last, First M.',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 1
  },
  {
    id: 'citation_style_ieee',
    code: 'IEEE',
    name: 'IEEE',
    inTextFormatTemplate: '[Number]',
    bibliographyRules: {
      journal: {
        template: '[Number] AuthorFirst AuthorLast, "Title of Article," Title of Journal, vol. volume, no. issue, pp. page-page, Month Year. doi:DOI',
        authors: 'First Last',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: '[Number] AuthorFirst AuthorLast, Title of Book. Publisher, Year.',
        authors: 'First Last',
        title: 'title-case'
      },
      conference: {
        template: '[Number] AuthorFirst AuthorLast, "Title of Paper," in Proceedings of Conference Name, pp. page-page, City, Country, Month Year. doi:DOI',
        authors: 'First Last',
        title: 'sentence-case'
      },
      website: {
        template: '[Number] AuthorFirst AuthorLast, "Title of Page," Site Name, Month Day, Year. [Online]. Available: URL',
        authors: 'First Last',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 2
  },
  {
    id: 'citation_style_chicago_authordate',
    code: 'CHICAGO_AUTHOR_DATE',
    name: 'Chicago (Author-Date)',
    inTextFormatTemplate: '(Author Year)',
    bibliographyRules: {
      journal: {
        template: 'AuthorLast, First. Year. "Title of Article." Title of Journal volume, no. issue: page-page. doi:DOI',
        authors: 'Last, First',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: 'AuthorLast, First. Year. Title of Book. Place: Publisher.',
        authors: 'Last, First',
        title: 'title-case'
      },
      conference: {
        template: 'AuthorLast, First. Year. "Title of Paper." Paper presented at Conference Name, City, Country, Month Day.',
        authors: 'Last, First',
        title: 'sentence-case'
      },
      website: {
        template: 'AuthorLast, First. "Title of Page." Site Name, Month Day, Year. URL',
        authors: 'Last, First',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: true,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 3
  },
  {
    id: 'citation_style_chicago_notes',
    code: 'CHICAGO_NOTES',
    name: 'Chicago (Notes-Bibliography)',
    inTextFormatTemplate: 'Note Number',
    bibliographyRules: {
      journal: {
        template: 'AuthorFirst AuthorLast, "Title of Article," Title of Journal volume, no. issue (Year): page-page. doi:DOI',
        authors: 'First Last',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: 'AuthorFirst AuthorLast, Title of Book (Place: Publisher, Year).',
        authors: 'First Last',
        title: 'title-case'
      },
      conference: {
        template: 'AuthorFirst AuthorLast, "Title of Paper," presented at Conference Name, City, Country, Month Day, Year.',
        authors: 'First Last',
        title: 'sentence-case'
      },
      website: {
        template: 'AuthorFirst AuthorLast, "Title of Page," Site Name, Month Day, Year, URL',
        authors: 'First Last',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: true,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 4
  },
  {
    id: 'citation_style_mla9',
    code: 'MLA9',
    name: 'MLA 9th Edition',
    inTextFormatTemplate: '(Author Page)',
    bibliographyRules: {
      journal: {
        template: 'AuthorLast, First. "Title of Article." Title of Journal, vol. volume, no. issue, Year, pp. page-page. DOI',
        authors: 'Last, First',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: 'AuthorLast, First. Title of Book. Publisher, Year.',
        authors: 'Last, First',
        title: 'title-case'
      },
      conference: {
        template: 'AuthorLast, First. "Title of Paper." Conference Name, City, Country, Month Day, Year.',
        authors: 'Last, First',
        title: 'sentence-case'
      },
      website: {
        template: 'AuthorLast, First. "Title of Page." Site Name, Month Day, Year, URL. Accessed Day Month Year.',
        authors: 'Last, First',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 5
  },
  {
    id: 'citation_style_harvard',
    code: 'HARVARD',
    name: 'Harvard Referencing',
    inTextFormatTemplate: '(Author Year)',
    bibliographyRules: {
      journal: {
        template: 'AuthorLast, First (Year) "Title of Article", Title of Journal, vol. volume, no. issue, pp. page-page.',
        authors: 'Last, First',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: 'AuthorLast, First (Year) Title of Book. Place: Publisher.',
        authors: 'Last, First',
        title: 'title-case'
      },
      conference: {
        template: 'AuthorLast, First (Year) "Title of Paper", in Proceedings of Conference Name, City, pp. page-page.',
        authors: 'Last, First',
        title: 'sentence-case'
      },
      website: {
        template: 'AuthorLast, First (Year) Title of Page. Available at: URL (Accessed: Day Month Year).',
        authors: 'Last, First',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'alphabetical',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 6
  },
  {
    id: 'citation_style_acm',
    code: 'ACM',
    name: 'ACM Reference Format',
    inTextFormatTemplate: '[Number]',
    bibliographyRules: {
      journal: {
        template: '[Number] AuthorFirst AuthorLast. Year. Title of Article. Title of Journal volume, issue (Month Year), pages. DOI',
        authors: 'First Last',
        title: 'sentence-case',
        journal: 'title-case'
      },
      book: {
        template: '[Number] AuthorFirst AuthorLast. Year. Title of Book. Publisher, Place.',
        authors: 'First Last',
        title: 'title-case'
      },
      conference: {
        template: '[Number] AuthorFirst AuthorLast. Year. Title of Paper. In Proceedings of Conference Name (Acronym). Publisher, pages. DOI',
        authors: 'First Last',
        title: 'sentence-case'
      },
      website: {
        template: '[Number] AuthorFirst AuthorLast. Year. Title of Page. URL Accessed: Month Day, Year.',
        authors: 'First Last',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 3,
    sortOrder: 7
  },
  {
    id: 'citation_style_nature',
    code: 'NATURE',
    name: 'Nature Journal Style',
    inTextFormatTemplate: 'Superscript Number',
    bibliographyRules: {
      journal: {
        template: 'Number. AuthorLast, A. A., AuthorLast, B. B. & AuthorLast, C. C. Title of article. Journal Abbreviation volume, pages (Year).',
        authors: 'Last, Initial',
        title: 'sentence-case',
        journal: 'abbreviated'
      },
      book: {
        template: 'Number. AuthorLast, A. A. Title of Book (Publisher, Year).',
        authors: 'Last, Initial',
        title: 'title-case'
      },
      conference: {
        template: 'Number. AuthorLast, A. A. Title of paper. in Conference Name pages (Publisher, Year).',
        authors: 'Last, Initial',
        title: 'sentence-case'
      },
      website: {
        template: 'Number. AuthorLast, A. A. Title of page. URL (Year).',
        authors: 'Last, Initial',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 5,
    sortOrder: 8
  },
  {
    id: 'citation_style_vancouver',
    code: 'VANCOUVER',
    name: 'Vancouver/ICMJE Medical Style',
    inTextFormatTemplate: '(Number)',
    bibliographyRules: {
      journal: {
        template: 'Number. AuthorLast AB, AuthorLast CD. Title of article. Journal Abbreviation. Year;volume(issue):pages. doi:DOI',
        authors: 'Last Initials',
        title: 'sentence-case',
        journal: 'abbreviated'
      },
      book: {
        template: 'Number. AuthorLast AB, AuthorLast CD. Title of book. Edition. Place: Publisher; Year.',
        authors: 'Last Initials',
        title: 'sentence-case'
      },
      conference: {
        template: 'Number. AuthorLast AB. Title of paper. In: Editor, editor. Conference Name; Year Month Day; City, Country. Place: Publisher; Year. p. pages.',
        authors: 'Last Initials',
        title: 'sentence-case'
      },
      website: {
        template: 'Number. AuthorLast AB. Title of page [Internet]. Place: Publisher; Year [cited Year Month Day]. Available from: URL',
        authors: 'Last Initials',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 6,
    sortOrder: 9
  },
  {
    id: 'citation_style_ama',
    code: 'AMA',
    name: 'American Medical Association',
    inTextFormatTemplate: 'Superscript Number',
    bibliographyRules: {
      journal: {
        template: 'Number. AuthorLast AB, AuthorLast CD. Title of article. Journal Abbreviation. Year;volume(issue):pages. doi:DOI',
        authors: 'Last Initials',
        title: 'sentence-case',
        journal: 'abbreviated'
      },
      book: {
        template: 'Number. AuthorLast AB, AuthorLast CD. Title of Book. Edition. Publisher; Year.',
        authors: 'Last Initials',
        title: 'title-case'
      },
      conference: {
        template: 'Number. AuthorLast AB. Title of paper. Presented at: Conference Name; Month Day, Year; City, Country.',
        authors: 'Last Initials',
        title: 'sentence-case'
      },
      website: {
        template: 'Number. AuthorLast AB. Title of page. URL. Published Year. Accessed Month Day, Year.',
        authors: 'Last Initials',
        title: 'sentence-case'
      }
    },
    bibliographySortOrder: 'order_of_appearance',
    supportsShortTitles: false,
    maxAuthorsBeforeEtAl: 6,
    sortOrder: 10
  }
];

async function seedCitationStyles() {
  try {
    console.log('Seeding citation style definitions...');

    for (const style of citationStyles) {
      await prisma.citationStyleDefinition.upsert({
        where: { code: style.code },
        update: style,
        create: style
      });
      console.log(`✓ Seeded ${style.code}: ${style.name}`);
    }

    console.log('Citation style seeding completed!');
  } catch (error) {
    console.error('Error seeding citation styles:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedCitationStyles();
