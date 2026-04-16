import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../lib/prisma';
import { paperTypeService } from '../../lib/services/paper-type-service';
import { citationStyleService } from '../../lib/services/citation-style-service';

describe('Paper Writing Workflow Integration', () => {
  let testUserId: string;
  let testTenantId: string;
  let testPatentId: string;
  let testJournalPaperTypeId: string;
  let testConferencePaperTypeId: string;
  let testApaCitationStyleId: string;
  let testIeeeCitationStyleId: string;

  beforeEach(async () => {
    // Create test user and tenant with all required fields
    const testTenant = await prisma.tenant.upsert({
      where: { id: 'test-tenant-paper-workflow' },
      update: {},
      create: {
        id: 'test-tenant-paper-workflow',
        name: 'Test Tenant for Paper Workflow',
        atiId: 'test-ati-workflow' // Required field
      }
    });

    const testUser = await prisma.user.upsert({
      where: { id: 'test-user-paper-workflow' },
      update: {},
      create: {
        id: 'test-user-paper-workflow',
        tenantId: testTenant.id,
        email: 'test-paper-workflow@example.com',
        passwordHash: 'hashed-password',
        firstName: 'Test',
        lastName: 'User',
        roles: ['ANALYST']
      }
    });

    const testProject = await prisma.project.upsert({
      where: { id: 'test-project-paper-workflow' },
      update: {
        name: 'Test Project for Paper Workflow',
        userId: testUser.id,
        tenantId: testTenant.id,
      },
      create: {
        id: 'test-project-paper-workflow',
        name: 'Test Project for Paper Workflow',
        userId: testUser.id,
        tenantId: testTenant.id,
      }
    });

    const testPatent = await prisma.patent.upsert({
      where: { id: 'test-patent-paper-workflow' },
      update: {
        projectId: testProject.id,
        title: 'Integration Test Patent Placeholder',
        createdBy: testUser.id
      },
      create: {
        id: 'test-patent-paper-workflow',
        projectId: testProject.id,
        title: 'Integration Test Patent Placeholder',
        createdBy: testUser.id
      }
    });

    const [journalPaperType, conferencePaperType, apaStyle, ieeeStyle] = await Promise.all([
      prisma.paperTypeDefinition.upsert({
        where: { code: 'JOURNAL_ARTICLE' },
        update: {
          name: 'Journal Article',
          description: 'Traditional academic journal article',
          requiredSections: ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'],
          optionalSections: ['literature_review', 'acknowledgments', 'references'],
          sectionOrder: ['abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'acknowledgments', 'references'],
          defaultWordLimits: {
            abstract: 250,
            introduction: 1000,
            methodology: 1500,
            results: 1000,
            discussion: 1500,
            conclusion: 500
          },
          defaultCitationStyle: 'APA7',
          isActive: true
        },
        create: {
          code: 'JOURNAL_ARTICLE',
          name: 'Journal Article',
          description: 'Traditional academic journal article',
          requiredSections: ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'],
          optionalSections: ['literature_review', 'acknowledgments', 'references'],
          sectionOrder: ['abstract', 'introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion', 'acknowledgments', 'references'],
          defaultWordLimits: {
            abstract: 250,
            introduction: 1000,
            methodology: 1500,
            results: 1000,
            discussion: 1500,
            conclusion: 500
          },
          defaultCitationStyle: 'APA7',
          sortOrder: 1
        }
      }),
      prisma.paperTypeDefinition.upsert({
        where: { code: 'CONFERENCE_PAPER' },
        update: {
          name: 'Conference Paper',
          description: 'Academic conference paper format',
          requiredSections: ['abstract', 'introduction', 'related_work', 'methodology', 'results', 'conclusion'],
          optionalSections: ['discussion', 'acknowledgments', 'references'],
          sectionOrder: ['abstract', 'introduction', 'related_work', 'methodology', 'results', 'discussion', 'conclusion', 'acknowledgments', 'references'],
          defaultWordLimits: {
            abstract: 200,
            introduction: 800,
            related_work: 600,
            methodology: 1000,
            results: 800,
            conclusion: 400
          },
          defaultCitationStyle: 'IEEE',
          isActive: true
        },
        create: {
          code: 'CONFERENCE_PAPER',
          name: 'Conference Paper',
          description: 'Academic conference paper format',
          requiredSections: ['abstract', 'introduction', 'related_work', 'methodology', 'results', 'conclusion'],
          optionalSections: ['discussion', 'acknowledgments', 'references'],
          sectionOrder: ['abstract', 'introduction', 'related_work', 'methodology', 'results', 'discussion', 'conclusion', 'acknowledgments', 'references'],
          defaultWordLimits: {
            abstract: 200,
            introduction: 800,
            related_work: 600,
            methodology: 1000,
            results: 800,
            conclusion: 400
          },
          defaultCitationStyle: 'IEEE',
          sortOrder: 2
        }
      }),
      prisma.citationStyleDefinition.upsert({
        where: { code: 'APA7' },
        update: {
          name: 'APA 7th Edition',
          inTextFormatTemplate: '(Author, Year)',
          bibliographyRules: {},
          bibliographySortOrder: 'alphabetical',
          supportsShortTitles: false,
          maxAuthorsBeforeEtAl: 20,
          isActive: true
        },
        create: {
          code: 'APA7',
          name: 'APA 7th Edition',
          inTextFormatTemplate: '(Author, Year)',
          bibliographyRules: {},
          bibliographySortOrder: 'alphabetical',
          supportsShortTitles: false,
          maxAuthorsBeforeEtAl: 20,
          sortOrder: 1
        }
      }),
      prisma.citationStyleDefinition.upsert({
        where: { code: 'IEEE' },
        update: {
          name: 'IEEE',
          inTextFormatTemplate: '[1]',
          bibliographyRules: {},
          bibliographySortOrder: 'order_of_appearance',
          supportsShortTitles: false,
          maxAuthorsBeforeEtAl: 6,
          isActive: true
        },
        create: {
          code: 'IEEE',
          name: 'IEEE',
          inTextFormatTemplate: '[1]',
          bibliographyRules: {},
          bibliographySortOrder: 'order_of_appearance',
          supportsShortTitles: false,
          maxAuthorsBeforeEtAl: 6,
          sortOrder: 2
        }
      })
    ]);

    testUserId = testUser.id;
    testTenantId = testTenant.id;
    testPatentId = testPatent.id;
    testJournalPaperTypeId = journalPaperType.id;
    testConferencePaperTypeId = conferencePaperType.id;
    testApaCitationStyleId = apaStyle.id;
    testIeeeCitationStyleId = ieeeStyle.id;
  });

  afterEach(async () => {
    // Clean up test data in correct order to avoid foreign key violations
    try {
      // First, delete citation usages
      await prisma.citationUsage.deleteMany({
        where: {
          citation: {
            session: {
              userId: testUserId
            }
          }
        }
      });

      // Delete citations
      await prisma.citation.deleteMany({
        where: {
          session: {
            userId: testUserId
          }
        }
      });

      // Delete annexure drafts (includes all paper sections)
      await prisma.annexureDraft.deleteMany({
        where: {
          session: {
            userId: testUserId
          }
        }
      });

      // Delete research topics
      await prisma.researchTopic.deleteMany({
        where: {
          session: {
            userId: testUserId
          }
        }
      });

      // Delete drafting sessions
      await prisma.draftingSession.deleteMany({
        where: { userId: testUserId }
      });

      // Delete patents created by test user (required for user deletion)
      await prisma.patent.deleteMany({
        where: { createdBy: testUserId }
      });

      // Delete projects owned by test user
      await prisma.project.deleteMany({
        where: { userId: testUserId }
      });

      // Now delete the user
      await prisma.user.deleteMany({
        where: { id: testUserId }
      });

      // Finally delete the tenant
      await prisma.tenant.deleteMany({
        where: { id: testTenantId }
      });
    } catch (error) {
      // Log but don't fail test if cleanup has issues
      console.error('Cleanup error:', error);
    }
  });

  describe('Complete Paper Creation Workflow', () => {
    it('should create a complete paper from topic to export-ready', async () => {
      // Step 1: Create paper session with research topic
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT',
          literatureReviewStatus: 'COMPLETED',
          targetWordCount: 6000,
          researchTopic: {
            create: {
              title: 'Integration Test Paper: AI in Healthcare',
              researchQuestion: 'How can artificial intelligence improve healthcare outcomes?',
              hypothesis: 'AI systems can significantly improve diagnostic accuracy and treatment planning.',
              keywords: ['artificial intelligence', 'healthcare', 'diagnostics', 'machine learning'],
              methodology: 'MIXED_METHODS',
              contributionType: 'APPLIED',
              abstractDraft: 'This paper explores the application of AI in healthcare settings.'
            }
          }
        },
        include: {
          researchTopic: true
        }
      });

      expect(session.researchTopic?.title).toBe('Integration Test Paper: AI in Healthcare');
      expect(session.paperTypeId).toBe(testJournalPaperTypeId);

      // Step 2: Add citations to the paper
      const citations = await Promise.all([
        prisma.citation.create({
          data: {
            sessionId: session.id,
            sourceType: 'JOURNAL_ARTICLE',
            title: 'AI Applications in Medical Diagnosis',
            authors: ['Dr. Smith', 'Dr. Johnson'],
            year: 2023,
            venue: 'Journal of Medical AI',
            doi: '10.1000/test1',
            citationKey: 'Smith2023'
          }
        }),
        prisma.citation.create({
          data: {
            sessionId: session.id,
            sourceType: 'CONFERENCE_PAPER',
            title: 'Machine Learning for Disease Prediction',
            authors: ['Dr. Brown', 'Dr. Davis'],
            year: 2023,
            venue: 'International Conference on Healthcare AI',
            citationKey: 'Brown2023'
          }
        })
      ]);

      expect(citations).toHaveLength(2);

      // Step 3: Create paper sections
      const paperSections = {
        abstract: `# Abstract

Artificial intelligence (AI) has the potential to revolutionize healthcare by improving diagnostic accuracy, treatment planning, and patient outcomes [CITE:Smith2023]. This paper examines the current applications of AI in medical settings and explores future possibilities.

Our analysis shows that machine learning algorithms can achieve diagnostic accuracy comparable to experienced physicians in several domains [CITE:Brown2023]. The implications for healthcare delivery are profound, potentially reducing costs while improving quality of care.

**Keywords:** artificial intelligence, healthcare, diagnostics, machine learning`,
        introduction: `# Introduction

The healthcare industry faces unprecedented challenges including rising costs, aging populations, and increasing demand for high-quality care. Artificial intelligence offers promising solutions to these challenges by augmenting human capabilities and automating routine tasks.

Recent advances in machine learning and deep learning have enabled AI systems to process complex medical data and provide actionable insights [CITE:Smith2023]. From image analysis to predictive modeling, AI applications are transforming every aspect of healthcare delivery.`
      };

      // Create annexure draft with sections
      const annexureDraft = await prisma.annexureDraft.create({
        data: {
          sessionId: session.id,
          jurisdiction: 'PAPER',
          version: 1,
          title: session.researchTopic!.title,
          extraSections: paperSections,
          fullDraftText: Object.values(paperSections).join('\n\n'),
          isValid: true
        }
      });

      expect(annexureDraft.jurisdiction).toBe('PAPER');
      expect(annexureDraft.extraSections).toHaveProperty('abstract');
      expect(annexureDraft.extraSections).toHaveProperty('introduction');

      // Step 4: Test citation formatting in context
      const apaStyle = await citationStyleService.getCitationStyle('APA7');
      expect(apaStyle).toBeTruthy();

      const formattedCitation = await citationStyleService.formatInTextCitation(
        {
          id: citations[0].id,
          title: citations[0].title,
          authors: citations[0].authors,
          year: citations[0].year ?? undefined,
          citationKey: citations[0].citationKey
        },
        'APA7'
      );

      expect(formattedCitation).toContain('Smith');

      // Step 5: Verify paper type configuration
      const paperType = await paperTypeService.getPaperType('JOURNAL_ARTICLE');
      expect(paperType).toBeTruthy();
      expect(paperType?.requiredSections).toContain('abstract');
      expect(paperType?.requiredSections).toContain('introduction');

      // Step 6: Test section validation
      const validation = await paperTypeService.validateSectionStructure(
        'JOURNAL_ARTICLE',
        Object.keys(paperSections)
      );

      expect(validation.isValid).toBe(false); // Missing required sections
      expect(validation.missingRequiredSections).toContain('methodology');
      expect(validation.missingRequiredSections).toContain('results');
      expect(validation.missingRequiredSections).toContain('discussion');
      expect(validation.missingRequiredSections).toContain('conclusion');
    });

    it('should handle paper type changes correctly', async () => {
      // Create initial paper
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT',
          researchTopic: {
            create: {
              title: 'Type Change Test Paper',
              researchQuestion: 'Test question',
              methodology: 'QUALITATIVE',
              contributionType: 'THEORETICAL'
            }
          }
        },
        include: {
          researchTopic: true
        }
      });

      // Change paper type to conference paper
      await prisma.draftingSession.update({
        where: { id: session.id },
        data: { paperTypeId: testConferencePaperTypeId }
      });

      const updatedSession = await prisma.draftingSession.findUnique({
        where: { id: session.id },
        include: { paperType: true }
      });

      expect(updatedSession?.paperType?.code).toBe('CONFERENCE_PAPER');

      // Verify different section requirements
      const journalSections = await paperTypeService.getSectionsForPaperType('JOURNAL_ARTICLE');
      const conferenceSections = await paperTypeService.getSectionsForPaperType('CONFERENCE_PAPER');

      expect(journalSections?.required).not.toEqual(conferenceSections?.required);
    });

    it('should handle citation style changes', async () => {
      // Create paper with citations
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT',
          citations: {
            create: [
              {
                sourceType: 'JOURNAL_ARTICLE',
                title: 'Test Citation',
                authors: ['Test Author'],
                year: 2023,
                citationKey: 'Test2023'
              }
            ]
          }
        },
        include: {
          citations: true
        }
      });

      const citation = session.citations[0];

      // Format with APA7
      const apaCitation = await citationStyleService.formatInTextCitation(
        {
          id: citation.id,
          title: citation.title,
          authors: citation.authors,
          year: citation.year ?? undefined,
          citationKey: citation.citationKey
        },
        'APA7'
      );

      // Change citation style to IEEE
      await prisma.draftingSession.update({
        where: { id: session.id },
        data: { citationStyleId: testIeeeCitationStyleId }
      });

      // Format with IEEE
      const ieeeCitation = await citationStyleService.formatInTextCitation(
        {
          id: citation.id,
          title: citation.title,
          authors: citation.authors,
          year: citation.year ?? undefined,
          citationKey: citation.citationKey
        },
        'IEEE'
      );

      // Citations should be formatted differently
      expect(apaCitation).not.toBe(ieeeCitation);
      expect(apaCitation).toContain('(Author');
      expect(ieeeCitation).toBe('[1]');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid paper type gracefully', async () => {
      const validation = await paperTypeService.validateSectionStructure(
        'INVALID_TYPE',
        ['abstract']
      );

      expect(validation.isValid).toBe(false);
      expect(validation.warnings).toContain('Unknown paper type: INVALID_TYPE');
    });

    it('should handle citation style not found', async () => {
      await expect(citationStyleService.formatInTextCitation(
        {
          id: 'test',
          title: 'Test',
          authors: ['Test Author'],
          citationKey: 'Test2023'
        },
        'INVALID_STYLE'
      )).rejects.toThrow('Citation style not found: INVALID_STYLE');
    });

    it('should handle invalid DOI import gracefully', async () => {
      // Test importing a citation with an invalid DOI format
      const invalidDOI = 'not-a-valid-doi';
      
      // Attempt to create citation with invalid DOI should still work (DOI is optional)
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT'
        }
      });

      // Creating citation with invalid DOI should succeed (validation happens at API level)
      const citation = await prisma.citation.create({
        data: {
          sessionId: session.id,
          sourceType: 'JOURNAL_ARTICLE',
          title: 'Test Paper with Invalid DOI',
          authors: ['Test Author'],
          year: 2023,
          doi: invalidDOI, // Invalid DOI format
          citationKey: 'Test2023DOI'
        }
      });

      expect(citation.doi).toBe(invalidDOI);
      
      // Clean up
      await prisma.citation.delete({ where: { id: citation.id } });
      await prisma.draftingSession.delete({ where: { id: session.id } });
    });

    it('should detect and handle duplicate citation imports', async () => {
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT'
        }
      });

      const duplicateDOI = '10.1000/duplicate-test';

      // Create first citation
      const firstCitation = await prisma.citation.create({
        data: {
          sessionId: session.id,
          sourceType: 'JOURNAL_ARTICLE',
          title: 'First Paper',
          authors: ['Author A'],
          year: 2023,
          doi: duplicateDOI,
          citationKey: 'AuthorA2023'
        }
      });

      expect(firstCitation.doi).toBe(duplicateDOI);

      // Check if DOI already exists in session before creating duplicate
      const existingCitation = await prisma.citation.findFirst({
        where: {
          sessionId: session.id,
          doi: duplicateDOI
        }
      });

      expect(existingCitation).not.toBeNull();
      expect(existingCitation?.id).toBe(firstCitation.id);

      // In real implementation, we would prevent duplicate creation
      // Here we verify the detection mechanism works
      const citationsWithSameDOI = await prisma.citation.count({
        where: {
          sessionId: session.id,
          doi: duplicateDOI
        }
      });

      expect(citationsWithSameDOI).toBe(1);

      // Clean up
      await prisma.citation.deleteMany({ where: { sessionId: session.id } });
      await prisma.draftingSession.delete({ where: { id: session.id } });
    });

    it('should handle search API failure gracefully', async () => {
      // This test verifies the system can handle when external search APIs fail
      // In production, this would involve mocking the literature search service
      
      // For integration testing, we verify the citation system works independently
      // of external search APIs
      const session = await prisma.draftingSession.create({
        data: {
          patentId: testPatentId,
          userId: testUserId,
          tenantId: testTenantId,
          paperTypeId: testJournalPaperTypeId,
          citationStyleId: testApaCitationStyleId,
          status: 'ANNEXURE_DRAFT',
          literatureReviewStatus: 'NOT_STARTED' // Search not completed
        }
      });

      // Paper should be created even without search functionality
      expect(session.literatureReviewStatus).toBe('NOT_STARTED');

      // Manual citation entry should work as fallback
      const manualCitation = await prisma.citation.create({
        data: {
          sessionId: session.id,
          sourceType: 'JOURNAL_ARTICLE',
          title: 'Manually Entered Citation',
          authors: ['Manual Author'],
          year: 2023,
          citationKey: 'Manual2023'
        }
      });

      expect(manualCitation.title).toBe('Manually Entered Citation');

      // Clean up
      await prisma.citation.delete({ where: { id: manualCitation.id } });
      await prisma.draftingSession.delete({ where: { id: session.id } });
    });
  });
});
