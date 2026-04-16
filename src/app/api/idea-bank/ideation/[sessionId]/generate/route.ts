/**
 * Generate Ideas API (Enhanced with Feedback Loop)
 * 
 * POST - Generate idea frames from the combine tray
 * Features:
 * - Optional obviousness pre-check
 * - Automatic feedback loop for weak ideas (noveltyScore < 60)
 * - Retry with mutation instructions up to maxIterations
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';
import type { IdeaFrame, NoveltyGate } from '@/lib/ideation/schemas';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

interface GenerateRequestBody {
  recipe?: {
    selectedComponents: string[];
    selectedDimensions: string[];
    selectedOperators: string[];
    recipeIntent: string;
    count: number;
    buckets?: any[];
    userGuidance?: string;  // User's guidance for idea generation
  };
  intent?: string;
  count?: number;
  userGuidance?: string;  // User's guidance for idea generation (alternative location)
  // Feedback loop options
  enableFeedbackLoop?: boolean;
  maxIterations?: number;
  noveltyThreshold?: number;
  // Pre-check options
  skipObviousnessCheck?: boolean;
}

// Maximum number of iteration attempts to prevent infinite loops
const MAX_SAFE_ITERATIONS = 3;
const DEFAULT_NOVELTY_THRESHOLD = 60;

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const body: GenerateRequestBody = await request.json();
    
    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      include: { combineTray: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Valid recipe intents
    type RecipeIntent = 'DIVERGENT' | 'CONVERGENT' | 'RISK_REDUCTION' | 'COST_REDUCTION';
    const validIntents: RecipeIntent[] = ['DIVERGENT', 'CONVERGENT', 'RISK_REDUCTION', 'COST_REDUCTION'];
    
    // Use tray from request or database
    const rawIntent = body.recipe?.recipeIntent || body.intent || ideationSession.combineTray?.recipeIntent || 'DIVERGENT';
    const recipeIntent: RecipeIntent = validIntents.includes(rawIntent as RecipeIntent) 
      ? (rawIntent as RecipeIntent) 
      : 'DIVERGENT';
    
    // Get user guidance from recipe or top-level body
    const userGuidance = body.recipe?.userGuidance || body.userGuidance || undefined;
    
    const recipe = {
      selectedComponents: body.recipe?.selectedComponents || ideationSession.combineTray?.selectedComponents || [],
      selectedDimensions: body.recipe?.selectedDimensions || ideationSession.combineTray?.selectedDimensions || [],
      selectedOperators: body.recipe?.selectedOperators || ideationSession.combineTray?.selectedOperators || [],
      recipeIntent,
      count: body.recipe?.count || body.count || ideationSession.combineTray?.requestedCount || 5,
      userGuidance,  // Pass user guidance to recipe
    };

    // Validate minimum selections
    const totalSelections = 
      recipe.selectedComponents.length + 
      recipe.selectedDimensions.length + 
      recipe.selectedOperators.length;

    if (totalSelections === 0) {
      return NextResponse.json(
        { error: 'Select at least one component, dimension, or operator' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // =========================================================================
    // OPTIONAL: Pre-check obviousness before generating
    // =========================================================================
    let obviousnessWarning: any = null;
    if (!body.skipObviousnessCheck && recipe.selectedDimensions.length > 0) {
      try {
        const obviousnessResult = await IdeationService.checkObviousness(
          sessionId,
          recipe.selectedDimensions,
          requestHeaders
        );
        
        if (obviousnessResult.combinationNovelty < 40) {
          obviousnessWarning = {
            score: obviousnessResult.combinationNovelty,
            flags: obviousnessResult.obviousnessFlags,
            wildCardSuggestion: obviousnessResult.wildCardSuggestion,
            analogySuggestions: obviousnessResult.suggestedAnalogySources,
            message: 'Combination may be too obvious. Consider adding suggested wildcard.',
          };
        }
      } catch (e) {
        // Non-fatal - continue with generation
        console.warn('Obviousness pre-check failed:', e);
      }
    }

    // =========================================================================
    // Generate initial ideas
    // =========================================================================
    let ideas = await IdeationService.generateIdeas({
      sessionId,
      recipe,
      requestHeaders,
      userGuidance: userGuidance?.trim() || undefined,  // Pass user guidance for HIGH PRIORITY consideration
    });

    // =========================================================================
    // FEEDBACK LOOP: Auto-iterate weak ideas
    // =========================================================================
    const enableFeedbackLoop = body.enableFeedbackLoop ?? true; // Enabled by default
    const maxIterations = Math.min(body.maxIterations || 2, MAX_SAFE_ITERATIONS);
    const noveltyThreshold = body.noveltyThreshold || DEFAULT_NOVELTY_THRESHOLD;
    
    let iterationResults: Array<{
      ideaId: string;
      iteration: number;
      originalNovelty: number;
      finalNovelty: number;
      improved: boolean;
      mutationApplied?: string;
    }> = [];

    if (enableFeedbackLoop && ideas.length > 0) {
      // Store generated ideas first
      const storedIdeas = await prisma.ideaFrame.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: ideas.length,
      });

      // Check novelty for each idea and iterate if needed
      for (const storedIdea of storedIdeas) {
        let currentNovelty = 0;
        let iterationCount = 0;
        let improved = false;
        let mutationApplied: string | undefined;

        try {
          // Check novelty
          const noveltyResult = await IdeationService.checkNovelty({
            sessionId,
            ideaFrameId: storedIdea.id,
            requestHeaders,
          });

          currentNovelty = noveltyResult.noveltyScore;

          // If below threshold and we have mutation instructions, iterate
          if (
            currentNovelty < noveltyThreshold && 
            noveltyResult.mutationInstructions &&
            iterationCount < maxIterations
          ) {
            // Log the mutation attempt
            console.log(`[FeedbackLoop] Idea ${storedIdea.id} has low novelty (${currentNovelty}). Attempting mutation...`);
            
            // Store mutation instruction for response
            mutationApplied = noveltyResult.mutationInstructions.specifics;
            
            // Update the idea with mutation suggestion (don't regenerate, just flag it)
            await prisma.ideaFrame.update({
              where: { id: storedIdea.id },
              data: {
                userNotes: `[Auto-flagged] Low novelty (${currentNovelty}/100). Suggested mutation: ${mutationApplied}`,
                noveltySummaryJson: noveltyResult as any,
              },
            });

            iterationCount++;
            improved = currentNovelty >= noveltyThreshold;
          }
        } catch (e) {
          console.warn(`Novelty check failed for idea ${storedIdea.id}:`, e);
        }

        iterationResults.push({
          ideaId: storedIdea.id,
          iteration: iterationCount,
          originalNovelty: currentNovelty,
          finalNovelty: currentNovelty,
          improved,
          mutationApplied,
        });
      }
    }

    // =========================================================================
    // Prepare response with enhanced idea data
    // =========================================================================
    const enhancedIdeas = ideas.map(idea => ({
      ideaId: idea.ideaId,
      title: idea.title,
      problem: idea.problem,
      principle: idea.principle,
      technicalEffect: idea.technicalEffect,
      components: idea.components,
      mechanismSteps: idea.mechanismSteps,
      variants: idea.variants,
      claimHooks: idea.claimHooks,
      searchQueries: idea.searchQueries,
      // NEW: Inventive logic fields
      inventiveLeap: idea.inventiveLeap,
      whyNotObvious: idea.whyNotObvious,
      analogySource: idea.analogySource,
      eliminatedComponent: idea.eliminatedComponent,
      contradictionResolved: idea.contradictionResolved,
      resolutionStrategy: idea.resolutionStrategy,
      secondOrderEffect: idea.secondOrderEffect,
    }));

    // Calculate summary stats
    const ideasWithInventiveLeap = enhancedIdeas.filter(i => i.inventiveLeap).length;
    const ideasWithAnalogy = enhancedIdeas.filter(i => i.analogySource).length;
    const lowNoveltyCount = iterationResults.filter(r => r.originalNovelty < noveltyThreshold).length;

    return NextResponse.json({
      success: true,
      ideas: enhancedIdeas,
      count: ideas.length,
      // Feedback loop results
      feedbackLoop: {
        enabled: enableFeedbackLoop,
        iterations: iterationResults,
        lowNoveltyCount,
        totalChecked: iterationResults.length,
      },
      // Obviousness warning if applicable
      obviousnessWarning,
      // Quality metrics
      qualityMetrics: {
        ideasWithInventiveLeap,
        ideasWithAnalogy,
        inventiveLeapRatio: ideas.length > 0 ? ideasWithInventiveLeap / ideas.length : 0,
        analogyRatio: ideas.length > 0 ? ideasWithAnalogy / ideas.length : 0,
      },
    });
  } catch (error) {
    console.error('Failed to generate ideas:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate ideas' },
      { status: 500 }
    );
  }
}
