import { BasePatentService, LLMResult, User } from './base-patent-service';
import { llmGateway } from './metering/gateway';
import { enforceMetering } from './metering/enforcement';
import { prisma } from './prisma';
import {
  IdeaBankIdea,
  IdeaBankReservation,
  IdeaBankHistory,
  IdeaBankStatus,
  IdeaBankReservationStatus,
  Prisma,
  TaskCode
} from '@prisma/client';

export interface ExtractedIdeaData {
  title: string;
  description: string;
  abstract?: string;
  domainTags: string[];
  technicalField?: string;
  keyFeatures: string[];
  potentialApplications: string[];
  noveltyScore?: number;
  priorArtSummary?: string;
}

export interface IdeaBankIdeaWithDetails extends IdeaBankIdea {
  creator: {
    id: string;
    name: string | null;
    email: string;
  };
  tenant?: {
    id: string;
    name: string;
  } | null;
  derivedFrom?: {
    id: string;
    title: string;
  } | null;
  derivedIdeas: {
    id: string;
    title: string;
    createdBy: string;
  }[];
  reservations: IdeaBankReservation[];
  _isReservedByCurrentUser?: boolean;
  _redactedDescription?: string;
}

export interface IdeaSearchFilters {
  query?: string;
  domainTags?: string[];
  technicalField?: string;
  status?: IdeaBankStatus;
  noveltyScoreMin?: number;
  noveltyScoreMax?: number;
  createdBy?: string;
  tenantId?: string;
}

export interface CreateIdeaData {
  title: string;
  description: string;
  abstract?: string;
  domainTags: string[];
  technicalField?: string;
  keyFeatures: string[];
  potentialApplications: string[];
  derivedFromIdeaId?: string;
}

export interface ReservationLimits {
  maxConcurrentReservations: number;
  defaultReservationDays: number;
}

/**
 * Service for managing the Idea Bank - a marketplace for AI-generated patent ideas
 */
export class IdeaBankService extends BasePatentService {

  private readonly DEFAULT_RESERVATION_DAYS = 30;
  private readonly MAX_CONCURRENT_RESERVATIONS = 10;

  /**
   * Check if user has access to Idea Bank feature (read-only operations)
   */
  private async checkIdeaBankAccess(
    requestHeaders: Record<string, string>,
    user: User,
    taskCode: TaskCode = TaskCode.IDEA_BANK_ACCESS
  ): Promise<void> {
    // For read-only operations (browsing, searching), we do a lighter check
    // without creating reservations to avoid concurrency limits
    if (taskCode === TaskCode.IDEA_BANK_ACCESS) {
      await this.checkBasicIdeaBankAccess(user);
      return;
    }

    // For write operations (reserving, editing), use full metering
    const result = await enforceMetering(
      { headers: requestHeaders },
      {
        tenantId: user.tenantId || 'default-tenant',
        featureCode: 'IDEA_BANK',
        taskCode: taskCode,
        userId: user.id,
        metadata: {
          idempotencyKey: `idea-bank-${user.id}-${Date.now()}`
        }
      }
    );

    if (!result.decision.allowed) {
      throw new Error(`Idea Bank access denied: ${result.decision.reason}`);
    }
  }

  /**
   * Basic access check without creating reservations (for read-only operations)
   */
  private async checkBasicIdeaBankAccess(user: User): Promise<void> {
    try {
      // Get tenant's current active plan
      const tenantPlan = await prisma.tenantPlan.findFirst({
        where: {
          tenantId: user.tenantId || 'default-tenant',
          status: 'ACTIVE'
        },
        include: {
          plan: true
        },
        orderBy: {
          effectiveFrom: 'desc'
        }
      });

      if (!tenantPlan?.plan) {
        throw new Error('No active plan found for tenant');
      }

      // Check if plan includes IDEA_BANK feature
      const planFeature = await prisma.planFeature.findFirst({
        where: {
          planId: tenantPlan.plan.id,
          feature: {
            code: 'IDEA_BANK'
          }
        }
      });

      if (!planFeature) {
        throw new Error(`Feature 'IDEA_BANK' not available in plan '${tenantPlan.plan.code}'`);
      }

      // Check tenant status
      const tenant = await prisma.tenant.findUnique({
        where: { id: user.tenantId || 'default-tenant' },
        select: { status: true }
      });

      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new Error('Tenant not found or inactive');
      }

    } catch (error) {
      throw new Error(`Idea Bank access denied: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get reservation limits for a user/tenant
   */
  private async getReservationLimits(user: User): Promise<ReservationLimits> {
    // TODO: Implement tier-based limits from tenant plans
    return {
      maxConcurrentReservations: this.MAX_CONCURRENT_RESERVATIONS,
      defaultReservationDays: this.DEFAULT_RESERVATION_DAYS
    };
  }

  /**
   * Search and filter ideas in the idea bank
   */
  async searchIdeas(
    requestHeaders: Record<string, string>,
    filters: IdeaSearchFilters,
    user: User,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    ideas: IdeaBankIdeaWithDetails[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
  }> {
    // Allow anyone to view public ideas without subscription
    // Only check subscription for write operations
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.IdeaBankIdeaWhereInput = {
      status: { not: 'ARCHIVED' }, // Exclude archived ideas
    };

    // Apply filters
    if (filters.query) {
      where.OR = [
        { title: { contains: filters.query, mode: 'insensitive' } },
        { description: { contains: filters.query, mode: 'insensitive' } },
        { abstract: { contains: filters.query, mode: 'insensitive' } },
        { keyFeatures: { hasSome: [filters.query] } },
        { potentialApplications: { hasSome: [filters.query] } },
      ];
    }

    if (filters.domainTags && filters.domainTags.length > 0) {
      where.domainTags = { hasSome: filters.domainTags };
    }

    if (filters.technicalField) {
      where.technicalField = { equals: filters.technicalField, mode: 'insensitive' };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.noveltyScoreMin !== undefined || filters.noveltyScoreMax !== undefined) {
      where.noveltyScore = {};
      if (filters.noveltyScoreMin !== undefined) {
        where.noveltyScore.gte = filters.noveltyScoreMin;
      }
      if (filters.noveltyScoreMax !== undefined) {
        where.noveltyScore.lte = filters.noveltyScoreMax;
      }
    }

    if (filters.createdBy) {
      where.createdBy = filters.createdBy;
    }

    if (filters.tenantId) {
      where.OR = where.OR || [];
      (where.OR as any[]).push(
        { tenantId: filters.tenantId },
        { tenantId: null } // Include global ideas
      );
    }

    // Get ideas with relations
    const [ideas, totalCount] = await Promise.all([
      prisma.ideaBankIdea.findMany({
        where,
        include: {
          creator: {
            select: { id: true, name: true, email: true }
          },
          tenant: {
            select: { id: true, name: true }
          },
          derivedFrom: {
            select: { id: true, title: true }
          },
          derivedIdeas: {
            select: { id: true, title: true, createdBy: true },
            take: 5
          },
          reservations: {
            where: {
              userId: user.id,
              status: 'ACTIVE'
            }
          }
        },
        orderBy: [
          { publishedAt: 'desc' },
          { createdAt: 'desc' }
        ],
        skip,
        take: limit
      }),
      prisma.ideaBankIdea.count({ where })
    ]);

    // Process ideas to add reservation status and redaction
    const processedIdeas = ideas.map(idea => {
      const isReservedByCurrentUser = idea.reservations.length > 0;
      let redactedDescription = idea.description;

      // If reserved and not by current user, redact the description
      if (idea.status === 'RESERVED' && !isReservedByCurrentUser) {
        // Show only first 2-3 words and one line of description
        const words = idea.description.split(' ');
        const visibleWords = words.slice(0, 3).join(' ');
        const firstLine = idea.description.split('\n')[0];
        redactedDescription = `${visibleWords}... [Content reserved - ${idea.reservedCount} reservations]`;
      }

      return {
        ...idea,
        _isReservedByCurrentUser: isReservedByCurrentUser,
        _redactedDescription: redactedDescription
      };
    });

    return {
      ideas: processedIdeas,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page
    };
  }

  /**
   * Get a single idea with full details
   */
  async getIdeaById(
    requestHeaders: Record<string, string>,
    ideaId: string,
    user: User
  ): Promise<IdeaBankIdeaWithDetails | null> {
    // Allow anyone to view public ideas without subscription
    // Only check subscription for write operations
    const idea = await prisma.ideaBankIdea.findUnique({
      where: { id: ideaId },
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        tenant: {
          select: { id: true, name: true }
        },
        reservations: {
          where: {
            userId: user.id,
            status: 'ACTIVE'
          }
        },
        derivedFrom: {
          select: { id: true, title: true }
        },
        derivedIdeas: {
          select: { id: true, title: true, createdBy: true },
          take: 5 // Show recent derivations
        }
      }
    });

    if (!idea) return null;

    const isReservedByCurrentUser = idea.reservations.length > 0;
    let description = idea.description;

    // Only show full content if not reserved or reserved by current user
    if (idea.status === 'RESERVED' && !isReservedByCurrentUser) {
      const words = idea.description.split(' ');
      const visibleWords = words.slice(0, 3).join(' ');
      description = `${visibleWords}... [Content reserved - ${idea.reservedCount} reservations]`;
    }

    return {
      ...idea,
      _isReservedByCurrentUser: isReservedByCurrentUser,
      _redactedDescription: description
    };
  }

  /**
   * Create a new idea in the idea bank
   */
  async createIdea(
    requestHeaders: Record<string, string> | undefined,
    data: CreateIdeaData,
    user: User
  ): Promise<IdeaBankIdea> {
    // Any user can create ideas (from novelty search, prior art analysis, etc.)
    // No subscription required for contributing to the idea bank
    // Validate input
    if (!data.title?.trim() || !data.description?.trim()) {
      throw new Error('Title and description are required');
    }

    // Create the idea
    const idea = await prisma.ideaBankIdea.create({
      data: {
        title: data.title.trim(),
        description: data.description.trim(),
        abstract: data.abstract?.trim(),
        domainTags: data.domainTags,
        technicalField: data.technicalField?.trim(),
        keyFeatures: data.keyFeatures,
        potentialApplications: data.potentialApplications,
        derivedFromIdeaId: data.derivedFromIdeaId,
        createdBy: user.id,
        tenantId: user.tenantId,
        publishedAt: new Date()
      }
    });

    // Log the creation
    await this.logIdeaAction(idea.id, 'CREATED', user.id, null, {
      title: idea.title,
      description: idea.description
    });

    return idea;
  }

  /**
   * Clone and edit an idea to create a new derived idea
   */
  async cloneAndEditIdea(
    requestHeaders: Record<string, string> | undefined,
    originalIdeaId: string,
    edits: Partial<CreateIdeaData>,
    user: User
  ): Promise<IdeaBankIdea> {
    // Any user can clone and edit ideas to create new ones
    // No subscription required for contributing to the idea bank

    // Get the original idea
    const originalIdea = await prisma.ideaBankIdea.findUnique({
      where: { id: originalIdeaId }
    });

    if (!originalIdea) {
      throw new Error('Original idea not found');
    }

    // Create the edited version
    const newIdea = await this.createIdea(requestHeaders, {
      title: edits.title || `${originalIdea.title} (Edited)`,
      description: edits.description || originalIdea.description,
      abstract: edits.abstract || originalIdea.abstract || undefined,
      domainTags: edits.domainTags || originalIdea.domainTags,
      technicalField: edits.technicalField || originalIdea.technicalField || undefined,
      keyFeatures: edits.keyFeatures || originalIdea.keyFeatures,
      potentialApplications: edits.potentialApplications || originalIdea.potentialApplications,
      derivedFromIdeaId: originalIdeaId
    }, user);

    return newIdea;
  }

  /**
   * Reserve an idea
   */
  async reserveIdea(
    requestHeaders: Record<string, string>,
    ideaId: string,
    user: User
  ): Promise<IdeaBankReservation> {
    // Check access to reserve ideas
    await this.checkIdeaBankAccess(requestHeaders, user, TaskCode.IDEA_BANK_RESERVE);
    // Check if idea exists and is reservable
    const idea = await prisma.ideaBankIdea.findUnique({
      where: { id: ideaId },
      include: {
        reservations: {
          where: {
            userId: user.id,
            status: 'ACTIVE'
          }
        }
      }
    });

    if (!idea) {
      throw new Error('Idea not found');
    }

    if (idea.status !== 'PUBLIC') {
      throw new Error('Idea is not available for reservation');
    }

    // Check if user already has an active reservation for this idea
    if (idea.reservations.length > 0) {
      throw new Error('You already have an active reservation for this idea');
    }

    // Check user's reservation limits
    const limits = await this.getReservationLimits(user);
    const activeReservationsCount = await prisma.ideaBankReservation.count({
      where: {
        userId: user.id,
        status: 'ACTIVE'
      }
    });

    if (activeReservationsCount >= limits.maxConcurrentReservations) {
      throw new Error(`You have reached the maximum number of concurrent reservations (${limits.maxConcurrentReservations})`);
    }

    // Create reservation
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + limits.defaultReservationDays);

    const reservation = await prisma.$transaction(async (tx) => {
      // Create reservation
      const reservation = await tx.ideaBankReservation.create({
        data: {
          ideaId,
          userId: user.id,
          expiresAt
        }
      });

      // Update idea status and reservation count
      await tx.ideaBankIdea.update({
        where: { id: ideaId },
        data: {
          status: 'RESERVED',
          reservedCount: { increment: 1 }
        }
      });

      return reservation;
    });

    // Log the reservation
    await this.logIdeaAction(ideaId, 'RESERVED', user.id, null, {
      reservationId: reservation.id,
      expiresAt: reservation.expiresAt
    });

    return reservation;
  }

  /**
   * Release a reservation
   */
  async releaseReservation(
    requestHeaders: Record<string, string>,
    ideaId: string,
    user: User
  ): Promise<void> {
    // Check access to Idea Bank
    await this.checkIdeaBankAccess(requestHeaders, user);
    const reservation = await prisma.ideaBankReservation.findFirst({
      where: {
        ideaId,
        userId: user.id,
        status: 'ACTIVE'
      }
    });

    if (!reservation) {
      throw new Error('No active reservation found for this idea');
    }

    await prisma.$transaction(async (tx) => {
      // Update reservation status
      await tx.ideaBankReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date()
        }
      });

      // Check if there are other active reservations for this idea
      const activeReservationsCount = await tx.ideaBankReservation.count({
        where: {
          ideaId,
          status: 'ACTIVE'
        }
      });

      // If no more active reservations, change status back to PUBLIC
      if (activeReservationsCount === 0) {
        await tx.ideaBankIdea.update({
          where: { id: ideaId },
          data: {
            status: 'PUBLIC'
          }
        });
      }
    });

    // Log the release
    await this.logIdeaAction(ideaId, 'RELEASED', user.id, null, {
      reservationId: reservation.id
    });
  }

  /**
   * Get user's active reservations
   */
  async getUserReservations(
    requestHeaders: Record<string, string>,
    user: User
  ): Promise<IdeaBankReservation[]> {
    // Check access to Idea Bank
    await this.checkIdeaBankAccess(requestHeaders, user);
    return await prisma.ideaBankReservation.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE'
      },
      include: {
        idea: {
          select: {
            id: true,
            title: true,
            status: true,
            reservedCount: true
          }
        }
      },
      orderBy: { reservedAt: 'desc' }
    });
  }

  /**
   * Send reserved idea to novelty search pipeline
   */
  async sendToNoveltySearch(
    requestHeaders: Record<string, string>,
    ideaId: string,
    user: User
  ): Promise<string> {
    // Check access to Idea Bank
    await this.checkIdeaBankAccess(requestHeaders, user);
    // Verify user has active reservation
    const reservation = await prisma.ideaBankReservation.findFirst({
      where: {
        ideaId,
        userId: user.id,
        status: 'ACTIVE'
      }
    });

    if (!reservation) {
      throw new Error('You must have an active reservation for this idea to send it to novelty search');
    }

    // Get the idea
    const idea = await prisma.ideaBankIdea.findUnique({
      where: { id: ideaId }
    });

    if (!idea) {
      throw new Error('Idea not found');
    }

    // Create novelty search run with idea data
    const searchRun = await prisma.noveltySearchRun.create({
      data: {
        userId: user.id,
        title: idea.title,
        inventionDescription: idea.description,
        config: {
          source: 'idea_bank',
          ideaId: idea.id,
          reservationId: reservation.id
        }
      }
    });

    // Update reservation to mark as sent to search
    await prisma.ideaBankReservation.update({
      where: { id: reservation.id },
      data: { sentToNoveltySearch: true }
    });

    // Log the action
    await this.logIdeaAction(ideaId, 'SENT_TO_NOVELTY_SEARCH', user.id, null, {
      searchRunId: searchRun.id
    });

    return searchRun.id;
  }

  /**
   * Send reserved idea to drafting pipeline
   */
  async sendToDrafting(
    requestHeaders: Record<string, string>,
    ideaId: string,
    user: User,
    projectId?: string
  ): Promise<string> {
    // Check access to Idea Bank
    await this.checkIdeaBankAccess(requestHeaders, user);
    // Verify user has active reservation
    const reservation = await prisma.ideaBankReservation.findFirst({
      where: {
        ideaId,
        userId: user.id,
        status: 'ACTIVE'
      }
    });

    if (!reservation) {
      throw new Error('You must have an active reservation for this idea to send it to drafting');
    }

    // Get the idea
    const idea = await prisma.ideaBankIdea.findUnique({
      where: { id: ideaId }
    });

    if (!idea) {
      throw new Error('Idea not found');
    }

    // Create drafting session with idea data
    const draftingSession = await prisma.draftingSession.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        patentId: '', // Will be set when patent is created
        status: 'IDEA_ENTRY'
      }
    });

    // Create idea record from the idea bank idea
    await prisma.ideaRecord.create({
      data: {
        sessionId: draftingSession.id,
        title: idea.title,
        rawInput: idea.description,
        normalizedData: {
          problem: idea.description,
          objectives: idea.potentialApplications,
          components: idea.keyFeatures,
          logic: idea.description,
          abstract: idea.abstract
        },
        abstract: idea.abstract,
        cpcCodes: [], // TODO: Extract from idea data
        ipcCodes: []  // TODO: Extract from idea data
      }
    });

    // Update reservation to mark as sent to drafting
    await prisma.ideaBankReservation.update({
      where: { id: reservation.id },
      data: { sentToDrafting: true }
    });

    // Log the action
    await this.logIdeaAction(ideaId, 'SENT_TO_DRAFTING', user.id, null, {
      draftingSessionId: draftingSession.id,
      projectId
    });

    return draftingSession.id;
  }

  /**
   * Clean up expired reservations
   */
  async cleanupExpiredReservations(): Promise<number> {
    const expiredReservations = await prisma.ideaBankReservation.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() }
      }
    });

    if (expiredReservations.length === 0) {
      return 0;
    }

    // Group by ideaId to update idea statuses
    const ideaIds = Array.from(new Set(expiredReservations.map(r => r.ideaId)));

    await prisma.$transaction(async (tx) => {
      // Mark reservations as expired
      await tx.ideaBankReservation.updateMany({
        where: {
          id: { in: expiredReservations.map(r => r.id) }
        },
        data: { status: 'EXPIRED' }
      });

      // For each idea, check if there are any remaining active reservations
      for (const ideaId of ideaIds) {
        const activeReservationsCount = await tx.ideaBankReservation.count({
          where: {
            ideaId,
            status: 'ACTIVE'
          }
        });

        // If no more active reservations, change status back to PUBLIC
        if (activeReservationsCount === 0) {
          await tx.ideaBankIdea.update({
            where: { id: ideaId },
            data: { status: 'PUBLIC' }
          });
        }
      }
    });

    return expiredReservations.length;
  }

  /**
   * Log an action on an idea
   */
  private async logIdeaAction(
    ideaId: string,
    action: string,
    userId: string,
    previousData?: any,
    newData?: any,
    notes?: string
  ): Promise<void> {
    await prisma.ideaBankHistory.create({
      data: {
        ideaId,
        action,
        userId,
        previousData,
        newData,
        notes
      }
    });
  }

  /**
   * Extract and add idea from novelty search results
   * This is called automatically during novelty search processing
   */
  async addIdeaFromNoveltySearch(
    extractedIdea: ExtractedIdeaData,
    user: User,
    sourceSearchId?: string
  ): Promise<IdeaBankIdea> {
    // Create idea data from extracted information
    const ideaData: CreateIdeaData = {
      title: extractedIdea.title,
      description: extractedIdea.description,
      abstract: extractedIdea.abstract,
      domainTags: extractedIdea.domainTags,
      technicalField: extractedIdea.technicalField,
      keyFeatures: extractedIdea.keyFeatures,
      potentialApplications: extractedIdea.potentialApplications,
      derivedFromIdeaId: undefined // This is a new idea from search
    };

    // Create the idea (no subscription required for contributing)
    const idea = await this.createIdea({}, ideaData, user);

    // Update with additional metadata
    await prisma.ideaBankIdea.update({
      where: { id: idea.id },
      data: {
        noveltyScore: extractedIdea.noveltyScore,
        priorArtSummary: extractedIdea.priorArtSummary,
        // Link to the source search if provided
        ...(sourceSearchId && {
          // You might want to add a field to link to the source search
        })
      }
    });

    return idea;
  }

  /**
   * Get idea statistics
   */
  async getIdeaStats(
    requestHeaders: Record<string, string>,
    user?: User
  ): Promise<{
    totalIdeas: number;
    publicIdeas: number;
    reservedIdeas: number;
    userReservations: number;
  }> {
    // Allow anyone to see public stats without subscription
    // Only check subscription for write operations
    const baseWhere = user?.tenantId ? {
      OR: [
        { tenantId: user.tenantId },
        { tenantId: null }
      ]
    } : {};

    const [totalIdeas, publicIdeas, reservedIdeas, userReservations] = await Promise.all([
      prisma.ideaBankIdea.count({ where: baseWhere }),
      prisma.ideaBankIdea.count({
        where: { ...baseWhere, status: 'PUBLIC' }
      }),
      prisma.ideaBankIdea.count({
        where: { ...baseWhere, status: 'RESERVED' }
      }),
      user ? prisma.ideaBankReservation.count({
        where: { userId: user.id, status: 'ACTIVE' }
      }) : Promise.resolve(0)
    ]);

    return {
      totalIdeas,
      publicIdeas,
      reservedIdeas,
      userReservations
    };
  }
}
