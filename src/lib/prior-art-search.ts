import { PrismaClient, PriorArtRunStatus, PriorArtIntersectionType } from '@prisma/client';
import { SerpApiProvider, serpApiProvider, SerpApiSearchResponse } from './serpapi-provider';
import { normalizePatentFromSearch, normalizePatentFromDetails, upsertPatent, upsertPatentDetails } from './prior-art-normalization';
import { NoveltyAssessmentService } from './novelty-assessment';

const prisma = new PrismaClient();

export interface PriorArtBundle {
  source_summary: {
    title: string;
    problem_statement: string;
    solution_summary: string;
  };
  core_concepts: string[];
  synonym_groups: string[][];
  phrases: string[];
  exclude_terms: string[];
  technical_features: string[];
  spec_limits: Array<{
    quantity: string;
    operator: '>' | '<' | '=' | '>=' | '<=';
    value: number;
    unit: string;
  }>;
  cpc_candidates: string[];
  ipc_candidates: string[];
  domain_tags: string[];
  date_window: { from?: string; to?: string };
  jurisdictions_preference: string[];
  ambiguous_terms: string[];
  sensitive_tokens: string[];
  query_variants: Array<{
    label: 'broad' | 'baseline' | 'narrow';
    q: string;
    num: number;
    page: number;
    notes: string;
  }>;
  serpapi_defaults: {
    engine: string;
    hl: string;
    no_cache: boolean;
  };
  fields_for_details: string[];
  detail_priority_rules: string;
}

interface ContentRelevance {
  titleMatches: number;
  abstractMatches: number;
  totalScore: number;
  relevancePercent: number;
  matchedTerms: string[];
  termDetails: { [term: string]: { inTitle: boolean; inAbstract: number } };
}

export class PriorArtSearchService {
  /**
   * Execute a complete prior art search
   */
  async executeSearch(bundleId: string, userId: string, jwtToken: string, includeScholar: boolean = false): Promise<string> {
    // Create run record
    const run = await prisma.priorArtRun.create({
      data: {
        bundleId,
        userId,
        status: PriorArtRunStatus.RUNNING,
        bundleHash: await this.generateBundleHash(bundleId),
        approvedBundle: await this.getApprovedBundle(bundleId) as any,
      },
    });

    try {
      const bundle = await this.getApprovedBundle(bundleId);
      const runId = run.id;

      // LEVEL 0: Local database first. If local match conclusively determines novelty, short-circuit.
      try {
        const level0 = await this.executeLevel0LocalCheck(runId, bundle, jwtToken);
        if (level0?.shortCircuit) {
          console.log(`🛑 Level 0 short-circuit: ${level0.determination}`);
          await prisma.priorArtRun.update({
            where: { id: runId },
            data: {
              status: PriorArtRunStatus.COMPLETED,
              finishedAt: new Date(),
              level0Checked: true,
              level0Determination: level0.determination as any,
              level0Results: level0.level0Results,
              level0ReportUrl: level0.reportUrl || null,
            },
          });
          return runId;
        }
      } catch (e) {
        console.warn('Level 0 local check failed, continuing with normal flow:', e);
      }

      // Execute each variant for both patents and scholar
      const allResults: Array<{ variant: string; results: SerpApiSearchResponse; engine: string }> = [];

      for (const variant of bundle.query_variants) {
        // Execute patent search
        const patentResults = await this.executeVariant(runId, variant, 'google_patents');
        allResults.push({ variant: variant.label, results: patentResults, engine: 'patents' });

        // Execute scholar search based on user preference and bundle config
        const shouldRunScholar = includeScholar && (
          bundle.serpapi_defaults?.engine === 'google_scholar' ||
                                bundle.serpapi_defaults?.engine === 'google_patents' ||
          !bundle.serpapi_defaults?.engine // Default to scholar if enabled and no specific config
        );

        console.log(`🔍 Bundle engine config: ${bundle.serpapi_defaults?.engine || 'undefined'} - User scholar preference: ${includeScholar} - Scholar search: ${shouldRunScholar ? 'ENABLED' : 'DISABLED'}`);

        if (shouldRunScholar) {
          try {
            console.log(`📚 Executing scholar search for variant: ${variant.label}`);
            const scholarResults = await this.executeVariant(runId, variant, 'google_scholar');
            allResults.push({ variant: variant.label, results: scholarResults, engine: 'scholar' });
            console.log(`✅ Scholar search completed for ${variant.label}: ${scholarResults.organic_results?.length || 0} results`);
          } catch (error) {
            console.error(`❌ Scholar search failed for variant ${variant.label}:`, error);
            // Continue with patent results only
          }
        } else {
          console.log(`⏭️ Skipping scholar search for variant ${variant.label} (engine config: ${bundle.serpapi_defaults?.engine})`);
        }
      }

      // Merge, dedupe, and score results
      await this.mergeAndScoreResults(runId, allResults, bundle);

      // 🚀 OPTIMIZED NOVELTY ASSESSMENT WORKFLOW
      console.log('🧠 Starting optimized novelty assessment workflow...');

      try {
        // Check if novelty assessment tables exist by trying a simple query
        let tablesExist = false;
        try {
          await prisma.noveltyAssessmentRun.findMany({ take: 1 });
          tablesExist = true;
        } catch (tableCheckError) {
          console.log('ℹ️ Novelty assessment tables not available yet (run migrations first)');
          console.log('⏭️ Skipping novelty assessment integration until tables are created');
          tablesExist = false;
        }

        if (tablesExist) {
          // LEVEL 1 NOVELTY ASSESSMENT: Analyze search results immediately
          console.log('📊 Running Level 1 Novelty Assessment (using search results only)...');

          // Get intersecting patents first, or fallback to top patents
          let level1Patents = await this.getIntersectingPatentsForNovelty(runId);

          if (level1Patents.length === 0) {
            console.log('ℹ️ No intersecting patents found, using top 5 most relevant patents for Level 1 analysis');
            const allPatents = await this.getLevel1PatentsForNovelty(runId);
            level1Patents = allPatents.slice(0, 5); // Top 5 most relevant (reduced from 15)
          } else {
            // Limit intersecting patents to 5 to avoid token limits
            if (level1Patents.length > 5) {
              console.log(`ℹ️ Limiting intersecting patents from ${level1Patents.length} to 5 for token efficiency`);
              level1Patents = level1Patents.slice(0, 5);
            }
          }

          if (level1Patents.length > 0) {

            const level1Result = await NoveltyAssessmentService.performLevel1Assessment({
              patentId: bundle.patentId,
              runId: runId,
              jwtToken: jwtToken,
              inventionSummary: {
                title: bundle.source_summary.title,
                problem: bundle.source_summary.problem_statement,
                solution: bundle.source_summary.solution_summary,
              },
              level1Patents: level1Patents,
            });

            // Check if we need Level 2 analysis
            if (level1Result.determination === 'DOUBT') {
              console.log('🤔 Level 1 assessment inconclusive - proceeding to Level 2 analysis');

              // LEVEL 2: Fetch detailed patent data only for patents that need it
              const patentsNeedingDetails = level1Result.patentsNeedingDetails || [];
              if (patentsNeedingDetails.length > 0) {
                console.log(`📥 Fetching detailed data for ${patentsNeedingDetails.length} patents`);
                await this.fetchDetailsForSelectedPatents(runId, patentsNeedingDetails, bundle.fields_for_details);

                // LEVEL 2 NOVELTY ASSESSMENT: Detailed analysis
                console.log('🔬 Running Level 2 Novelty Assessment (detailed analysis)...');
                const level2Result = await NoveltyAssessmentService.performLevel2Assessment({
                  patentId: bundle.patentId,
                  runId: runId,
                  jwtToken: jwtToken,
                  inventionSummary: {
                    title: bundle.source_summary.title,
                    problem: bundle.source_summary.problem_statement,
                    solution: bundle.source_summary.solution_summary,
                  },
                  level1Result: level1Result,
                  detailedPatents: patentsNeedingDetails,
                });

                console.log(`✅ Final determination: ${level2Result.determination}`);
              }
            } else {
              console.log(`✅ Level 1 assessment conclusive: ${level1Result.determination}`);
              console.log('⏭️ Skipping Level 2 analysis - sufficient data from search results');
            }
          } else {
            console.log('ℹ️ No relevant patents found in search results');
          }
        } else {
          // Fallback to old behavior: fetch all details
          console.log('📊 Fallback: Fetching all patent details (novelty assessment tables not available)');
          await this.fetchDetailsForShortlist(runId, bundle.fields_for_details);
        }
      } catch (noveltyError) {
        console.error('❌ Novelty assessment integration error:', noveltyError);

        // Provide detailed error analysis for debugging
        const errorMessage = noveltyError instanceof Error ? noveltyError.message : String(noveltyError);
        console.log('📋 Search will complete with basic results only - novelty assessment unavailable');
        console.log('🔍 Novelty assessment error details:', {
          error: errorMessage,
          type: noveltyError?.constructor?.name || 'Unknown',
          runId: runId,
          bundleId: bundleId
        });

        // Fallback: ensure we still fetch details if novelty assessment fails
        try {
          console.log('🔄 Proceeding with basic patent search results (no novelty analysis)');
          await this.fetchDetailsForShortlist(runId, bundle.fields_for_details);
        } catch (fallbackError) {
          console.error('❌ Fallback detail fetching also failed:', fallbackError);
          console.log('⚠️ Search completed with minimal results due to multiple failures');
        }
      }

      // Mark as completed
      console.log(`✅ Search run ${runId} completed successfully`);
      const completedRun = await prisma.priorArtRun.update({
        where: { id: runId },
        data: {
          status: PriorArtRunStatus.COMPLETED,
          finishedAt: new Date(),
        },
      });
      console.log(`📊 Updated run status to COMPLETED:`, {
        id: completedRun.id,
        status: completedRun.status,
        finishedAt: completedRun.finishedAt
      });

      return runId;
    } catch (error) {
      // Mark as failed
      console.error(`❌ Search run ${run.id} failed:`, error);
      const failedRun = await prisma.priorArtRun.update({
        where: { id: run.id },
        data: {
          status: PriorArtRunStatus.FAILED,
          finishedAt: new Date(),
        },
      });
      console.log(`📊 Updated run status to FAILED:`, {
        id: failedRun.id,
        status: failedRun.status,
        finishedAt: failedRun.finishedAt
      });
      throw error;
    }
  }

  /**
   * Execute a single variant search
   */
  private async executeVariant(
    runId: string,
    variant: any,
    engine: 'google_patents' | 'google_scholar' = 'google_patents'
  ): Promise<SerpApiSearchResponse> {
    // Create variant execution record - use base label for now
    // TODO: Later we can differentiate patent vs scholar executions
    const executionLabel = variant.label.toUpperCase();

    // Check if execution record already exists for this run and label
    let variantExec = await prisma.priorArtQueryVariantExecution.findFirst({
      where: {
        runId,
        label: executionLabel,
      },
    });

    if (!variantExec) {
      variantExec = await prisma.priorArtQueryVariantExecution.create({
        data: {
          runId,
          label: executionLabel,
          query: variant.q,
          num: variant.num,
          pageTarget: variant.page,
        },
      });
    }

    try {
      // Try local search first
      const localResults = engine === 'google_patents'
        ? await this.searchLocal(variant.q, variant.num)
        : [];
      let apiResults: SerpApiSearchResponse | null = null;

      if (localResults.length < variant.num) {
        // Need API call
        console.log(`🔍 Making API call to ${engine} with query: "${variant.q}" (num: ${variant.num - localResults.length})`);

        if (engine === 'google_scholar') {
          apiResults = await serpApiProvider.searchScholar({
            q: variant.q,
            num: variant.num - localResults.length,
            start: ((variant.page - 1) * variant.num),
          });
        } else {
          apiResults = await serpApiProvider.searchPatents({
            q: variant.q,
            num: variant.num - localResults.length,
            start: ((variant.page - 1) * variant.num),
          });
        }

        console.log(`📊 API call result: ${apiResults?.organic_results?.length || 0} results`);
        if (!apiResults?.organic_results || apiResults.organic_results.length === 0) {
          console.log(`⚠️  No results returned. API response:`, JSON.stringify(apiResults, null, 2));
        }

        // Update API call count
        await prisma.priorArtQueryVariantExecution.update({
          where: { id: variantExec.id },
          data: { apiCalls: { increment: 1 } },
        });

        // Store raw results
        await prisma.priorArtRawResult.create({
          data: {
            runId,
            variantId: variantExec.id,
            pageNo: variant.page,
            payload: apiResults,
          },
        });

        // Normalize and store results (only for patents, scholars are handled later)
        if (apiResults.organic_results && engine === 'google_patents') {
          for (const result of apiResults.organic_results) {
            const normalized = normalizePatentFromSearch(result as any); // We know this is a patent result from the engine check
            await upsertPatent(normalized);

            // Create variant hit
            await prisma.priorArtVariantHit.create({
              data: {
                runId,
                variantId: variantExec.id,
                publicationNumber: normalized.publicationNumber,
                rankInVariant: result.position || 0,
                snippet: result.snippet,
              },
            });
          }
        }
      }

      // Update variant execution with results
      await prisma.priorArtQueryVariantExecution.update({
        where: { id: variantExec.id },
        data: {
          pageExecuted: variant.page,
          resultsCount: (localResults.length + (apiResults?.organic_results?.length || 0)),
          executedAt: new Date(),
        },
      });

      return apiResults || { organic_results: localResults } as any;
    } catch (error) {
      console.error(`Variant ${variant.label} failed:`, error);
      throw error;
    }
  }

  /**
   * Calculate content relevance for a patent against search terms
   */
  private calculateContentRelevance(patent: any, searchTerms: string[], synonymsMap: { [key: string]: string[] }): ContentRelevance {
    const title = patent.title?.toLowerCase() || '';
    const abstract = patent.abstract?.toLowerCase() || '';

    let totalScore = 0;
    const matchedTerms = new Set<string>();
    const termDetails: { [term: string]: { inTitle: boolean; inAbstract: number } } = {};

    // Process each search term and its synonyms
    for (const term of searchTerms) {
      const termLower = term.toLowerCase();
      const synonyms = synonymsMap[termLower] || [];
      const allVariants = [termLower, ...synonyms.map(s => s.toLowerCase())];

      let termInTitle = false;
      let termInAbstract = 0;

      // Check title (higher weight - 3 points per match)
      for (const variant of allVariants) {
        if (title.includes(variant)) {
          termInTitle = true;
          totalScore += 3;
          matchedTerms.add(term);
          break; // Only count once per term in title
        }
      }

      // Check abstract (1 point per occurrence)
      for (const variant of allVariants) {
        const occurrences = (abstract.match(new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        termInAbstract += occurrences;
        totalScore += occurrences;
      }

      if (termInTitle || termInAbstract > 0) {
        termDetails[term] = {
          inTitle: termInTitle,
          inAbstract: termInAbstract
        };
      }
    }

    // Calculate relevance percentage (normalize to 0-100)
    // Assume maximum possible score is roughly terms * (title_weight + avg_abstract_occurrences)
    const maxPossibleScore = searchTerms.length * 4; // Conservative estimate
    const relevancePercent = Math.min(100, Math.round((totalScore / maxPossibleScore) * 100));

    return {
      titleMatches: Object.values(termDetails).filter(d => d.inTitle).length,
      abstractMatches: Object.values(termDetails).reduce((sum, d) => sum + d.inAbstract, 0),
      totalScore,
      relevancePercent,
      matchedTerms: Array.from(matchedTerms),
      termDetails
    };
  }

  /**
   * Extract search terms from bundle with synonym expansion
   */
  private extractSearchTerms(bundle: PriorArtBundle): { terms: string[], synonymsMap: { [key: string]: string[] } } {
    const terms = new Set<string>();
    const synonymsMap: { [key: string]: string[] } = {};

    // Add core concepts
    bundle.core_concepts.forEach(concept => {
      terms.add(concept.toLowerCase());
    });

    // Add phrases (split and add individual words)
    bundle.phrases.forEach(phrase => {
      const words = phrase.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 2) terms.add(word); // Skip very short words
      });
    });

    // Add technical features
    bundle.technical_features.forEach(feature => {
      terms.add(feature.toLowerCase());
    });

    // Process synonym groups
    bundle.synonym_groups.forEach(group => {
      const canonical = group[0].toLowerCase();
      const synonyms = group.slice(1).map(s => s.toLowerCase());

      terms.add(canonical);
      synonymsMap[canonical] = synonyms;
    });

    return {
      terms: Array.from(terms),
      synonymsMap
    };
  }

  /**
   * Calculate dynamic threshold to get ~15 patents while staying within 30-80% range
   */
  private calculateDynamicThreshold(patentRelevanceScores: number[], targetCount: number = 15): number {
    if (patentRelevanceScores.length === 0) return 30;

    // Sort scores descending
    const sortedScores = [...patentRelevanceScores].sort((a, b) => b - a);

    // Try to find threshold that gives us target count
    let threshold = 50; // Start with 50%

    // If we have too many high-scoring patents, increase threshold
    if (sortedScores.filter(score => score >= 50).length > targetCount * 1.5) {
      // Find threshold that gives us approximately target count
      const targetIndex = Math.min(targetCount - 1, sortedScores.length - 1);
      threshold = Math.max(50, sortedScores[targetIndex]);
    }
    // If we have too few high-scoring patents, decrease threshold (but not below 30%)
    else if (sortedScores.filter(score => score >= 50).length < targetCount * 0.5) {
      threshold = Math.max(30, Math.min(50, sortedScores[Math.floor(sortedScores.length * 0.3)] || 30));
    }

    // Ensure threshold stays within 30-80% range
    return Math.max(30, Math.min(80, threshold));
  }

  /**
   * Merge results from all variants and calculate content-based scores
   */
  private async mergeAndScoreResults(
    runId: string,
    variantResults: Array<{
      variant: string;
      results: SerpApiSearchResponse;
      engine: string;
    }>,
    bundle: PriorArtBundle
  ): Promise<void> {
    // Extract search terms and synonyms from bundle
    const { terms: searchTerms, synonymsMap } = this.extractSearchTerms(bundle);
    console.log(`🔍 Extracted ${searchTerms.length} search terms with synonyms:`, searchTerms);

    // Collect all patent results with their content relevance
    const patentResults = new Map<string, {
      patent: any;
      relevanceScores: { [variant: string]: ContentRelevance };
      foundInVariants: string[];
      engine: string;
    }>();

    // Process each variant's results
    for (const variantResult of variantResults) {
      const variant = variantResult.variant;
      const results = variantResult.results;
      const engine = variantResult.engine;

      const resultType = engine === 'scholar' ? 'scholarly articles' : 'patents';
      console.log(`🔍 Processing ${variant} variant ${resultType} results:`, results.organic_results?.length || 0, 'found');

      if (results.organic_results && engine === 'patents') { // Only process patents for content analysis
        for (const result of results.organic_results) {
          const patentResult = result as any;
          const pubNum = SerpApiProvider.normalizePatentId(patentResult.publication_number || patentResult.patent_id);

          if (!pubNum) continue;

          // Calculate content relevance for this patent against search terms
          const relevanceScore = this.calculateContentRelevance(result, searchTerms, synonymsMap);

          if (!patentResults.has(pubNum)) {
            patentResults.set(pubNum, {
              patent: result,
              relevanceScores: {},
              foundInVariants: [],
              engine: 'patents'
            });
          }

          const patentData = patentResults.get(pubNum)!;
          patentData.relevanceScores[variant] = relevanceScore;
          patentData.foundInVariants.push(`${variant}_${engine}`);

          console.log(`  ${variant}: ${pubNum} - Relevance: ${relevanceScore.relevancePercent}% (${relevanceScore.matchedTerms.length} terms matched)`);
        }
      }
    }

    console.log(`📊 Total unique patents analyzed: ${patentResults.size}`);

    // Handle scholar results separately (store but don't score for intersection)
    for (const variantResult of variantResults) {
      const variant = variantResult.variant;
      const results = variantResult.results;
      const engine = variantResult.engine;

      if (results.organic_results && engine === 'scholar') {
        for (const result of results.organic_results) {
          const scholarResult = result as any;
          const identifier = scholarResult.link || scholarResult.title || `scholar_${Date.now()}_${Math.random()}`;

          // Store scholar content
          await prisma.priorArtScholarContent.upsert({
            where: { identifier },
            update: {
              title: scholarResult.title || '',
              authors: scholarResult.authors || [],
              publication: scholarResult.publication || '',
              abstract: scholarResult.snippet || '',
            },
            create: {
            identifier,
              title: scholarResult.title || '',
              authors: scholarResult.authors || [],
              publication: scholarResult.publication || '',
              abstract: scholarResult.snippet || '',
            source: 'Google Scholar',
          },
        });

          // Create unified result for scholar
          await prisma.priorArtUnifiedResult.upsert({
            where: {
              runId_publicationNumber: {
                runId,
                publicationNumber: `scholar:${identifier}`,
              },
            },
            update: {
              foundInVariants: [`${variant}_scholar`],
              intersectionType: 'NONE',
              score: 0,
              shortlisted: false,
            },
            create: {
            runId,
              publicationNumber: `scholar:${identifier}`,
            contentType: 'SCHOLAR',
            scholarIdentifier: identifier,
              foundInVariants: [`${variant}_scholar`],
              intersectionType: 'NONE',
              score: 0,
            shortlisted: false,
          },
        });
        }
      }
    }

    // Calculate dynamic threshold based on all patent relevance scores
    const allRelevanceScores = Array.from(patentResults.values()).map(p =>
      Math.max(...Object.values(p.relevanceScores).map(r => r.relevancePercent))
    );

    const dynamicThreshold = this.calculateDynamicThreshold(allRelevanceScores, 15);
    console.log(`🎯 Dynamic relevance threshold calculated: ${dynamicThreshold}% (from ${allRelevanceScores.length} patents)`);

    // Use ALL patents for display, but prioritize high-relevance ones for shortlisting
    const allPatents = Array.from(patentResults.entries());

    // Check for intersections (patents that appear in multiple variants)
    const intersectingPatents = allPatents.filter(([pubNum, data]) =>
      data.foundInVariants.length >= 2
    );

    console.log(`🎯 Found ${intersectingPatents.length} intersecting patents (appear in ≥2 variants)`);

    // If we have intersections, use those
    let patentsToShortlist = intersectingPatents;

    // If no intersections, select top patents by relevance from each variant
    if (intersectingPatents.length === 0) {
      console.log(`⚠️ No intersecting patents found. Selecting top patents by relevance score...`);

      // Group patents by their best-performing variant
      const byVariant: { [variant: string]: Array<[string, any]> } = {};

      for (const [pubNum, data] of allPatents) {
        for (const [variant, relevance] of Object.entries(data.relevanceScores)) {
          if (!byVariant[variant]) byVariant[variant] = [];
          byVariant[variant].push([pubNum, { ...data, bestRelevance: relevance }]);
        }
      }

      // Select top 5 patents from each variant by relevance score
      const selectedFromVariants: Array<[string, any]> = [];
      for (const [variant, patents] of Object.entries(byVariant)) {
        const sortedByRelevance = patents.sort((a, b) =>
          b[1].bestRelevance.relevancePercent - a[1].bestRelevance.relevancePercent
        );
        const topFromVariant = sortedByRelevance.slice(0, 5);
        selectedFromVariants.push(...topFromVariant);
        console.log(`📄 Selected ${topFromVariant.length} top patents from ${variant} variant`);
      }

      patentsToShortlist = selectedFromVariants;
    }

    // Create unified results for ALL patents (show all results with relevance scores)
    for (const [pubNum, data] of allPatents) {
      const intersectionType = this.calculateIntersectionType(data.foundInVariants);

      // Calculate overall relevance score (average of variant scores)
      const relevanceScores = Object.values(data.relevanceScores);
      const avgRelevancePercent = relevanceScores.length > 0
        ? Math.round(relevanceScores.reduce((sum, r) => sum + r.relevancePercent, 0) / relevanceScores.length)
        : 0;

      // Convert percentage to decimal for database storage (85% -> 0.85)
      const avgRelevance = avgRelevancePercent / 100;

      // Store individual relevance scores in rank fields (instead of position ranks)
      const broadRelevance = data.relevanceScores.broad?.relevancePercent || null;
      const baselineRelevance = data.relevanceScores.baseline?.relevancePercent || null;
      const narrowRelevance = data.relevanceScores.narrow?.relevancePercent || null;

      // Determine if this patent should be shortlisted (high relevance or intersecting)
      const isShortlisted = patentsToShortlist.some(([shortlistedPubNum]) => shortlistedPubNum === pubNum);

      await prisma.priorArtUnifiedResult.upsert({
        where: {
          runId_publicationNumber: {
            runId,
            publicationNumber: pubNum,
          },
        },
        update: {
          foundInVariants: data.foundInVariants,
          rankBroad: broadRelevance,
          rankBaseline: baselineRelevance,
          rankNarrow: narrowRelevance,
          intersectionType,
          score: avgRelevance, // Overall relevance percentage
          shortlisted: isShortlisted,
        },
        create: {
          runId,
          publicationNumber: pubNum,
            contentType: 'PATENT',
            scholarIdentifier: null,
            foundInVariants: data.foundInVariants,
          rankBroad: broadRelevance,
          rankBaseline: baselineRelevance,
          rankNarrow: narrowRelevance,
            intersectionType,
          score: avgRelevance,
          shortlisted: isShortlisted,
          },
        });

      console.log(`${isShortlisted ? '✅ Shortlisted' : '📄 Listed'} patent: ${pubNum} (relevance: ${avgRelevance}%, intersection: ${intersectionType})`);
    }

    console.log(`🎯 Shortlisted ${patentsToShortlist.length} patents for detailed analysis out of ${allPatents.length} total results`);
  }

  /**
   * Fetch details for shortlisted patents
   */
  private async fetchDetailsForShortlist(runId: string, fields: string[]): Promise<void> {
    const shortlisted = await prisma.priorArtUnifiedResult.findMany({
      where: { runId, shortlisted: true },
      select: { publicationNumber: true },
    });

    for (const { publicationNumber } of shortlisted) {
      try {
        // Check if we already have details
        const existing = await prisma.priorArtPatentDetail.findUnique({
          where: { publicationNumber },
        });

        if (existing && this.isRecent(existing.fetchedAt)) {
          continue; // Skip if recent
        }

        // Try different patent ID formats
        const patentIds = [
          `patent/${publicationNumber}/en`,
          publicationNumber,
        ];

        let details = null;
        let successfulPatentId = null;

        for (const patentId of patentIds) {
          try {
            details = await serpApiProvider.getPatentDetails({
              patentId,
              fields,
            });
            successfulPatentId = patentId;
            break;
          } catch (error) {
            console.warn(`Failed to fetch details for ${patentId}:`, error);
          }
        }

        if (details) {
          // Store raw details
          await prisma.priorArtRawDetail.create({
            data: {
              publicationNumber,
              patentId: details.search_parameters?.patent_id || successfulPatentId || publicationNumber,
              payload: details as any,
            },
          });

          // Normalize and upsert
          const normalized = normalizePatentFromDetails(details, publicationNumber);
          await upsertPatent(normalized);
          await upsertPatentDetails(publicationNumber, details);
        }
      } catch (error) {
        console.error(`Failed to fetch details for ${publicationNumber}:`, error);
      }
    }
  }

  /**
   * Fetch detailed patent data for selected patents only (Level 2 optimization)
   */
  private async fetchDetailsForSelectedPatents(
    runId: string,
    selectedPatents: string[],
    fields: string[]
  ): Promise<void> {
    console.log(`📥 Fetching details for ${selectedPatents.length} selected patents`);

    for (const publicationNumber of selectedPatents) {
      try {
        // Check if we already have details
        const existing = await prisma.priorArtPatentDetail.findUnique({
          where: { publicationNumber },
        });

        if (existing && this.isRecent(existing.fetchedAt)) {
          console.log(`⏭️ Skipping ${publicationNumber} - recent details exist`);
          continue; // Skip if recent
        }

        // Try different patent ID formats
        const patentIds = [
          `patent/${publicationNumber}/en`,
          publicationNumber,
        ];

        let details = null;
        let successfulPatentId = null;

        for (const patentId of patentIds) {
          try {
            console.log(`🔍 Fetching details for ${patentId}...`);
            details = await serpApiProvider.getPatentDetails({
              patentId,
              fields,
            });
            successfulPatentId = patentId;
            console.log(`✅ Successfully fetched details for ${publicationNumber}`);
            break;
          } catch (error) {
            console.warn(`❌ Failed to fetch details for ${patentId}:`, error instanceof Error ? error.message : String(error));
          }
        }

        if (details) {
          // Store raw details
          await prisma.priorArtRawDetail.create({
            data: {
              publicationNumber,
              patentId: details.search_parameters?.patent_id || successfulPatentId || publicationNumber,
              payload: details as any,
            },
          });

          // Store raw details only (normalization handled by upsertPatentDetails)
          await upsertPatentDetails(publicationNumber, details);
        } else {
          console.error(`❌ Failed to fetch details for ${publicationNumber} with any patent ID format`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Error fetching details for ${publicationNumber}:`, error instanceof Error ? error.message : String(error));
      }
    }

    console.log(`✅ Completed fetching details for selected patents`);
  }

  /**
   * Local search implementation (basic for now)
   */
  private async searchLocal(query: string, limit: number): Promise<any[]> {
    // Basic local search: simple ILIKE matches over title and abstract
    // Extract simple keywords by splitting on spaces and removing quotes
    const q = query.replace(/"/g, ' ').toLowerCase();
    const tokens = Array.from(new Set(q.split(/\s+/).filter(t => t && t.length > 2))).slice(0, 8);

    if (tokens.length === 0) return [];

    // Fetch a window of candidates, then score in JS similar to calculateContentRelevance
    const candidates = await prisma.localPatent.findMany({
      take: Math.max(limit * 10, 100),
    });

    const scored = candidates.map((p) => {
      const title = (p.title || '').toLowerCase();
      const abstract = (p.abstract || p.abstractOriginal || '').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t)) score += 3;
        const occurrences = (abstract.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        score += occurrences;
      }
      return { patent: p, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // Map to SerpAPI-like organic_results entries so downstream processing works
    return top.map(({ patent }, idx) => ({
      position: idx + 1,
      title: patent.title,
      snippet: (patent.abstract || patent.abstractOriginal || '').slice(0, 500),
      publication_number: patent.publicationNumber,
      link: undefined,
    }));
  }

  /**
   * Calculate intersection type
   */
  private calculateIntersectionType(foundInVariants: string[]): PriorArtIntersectionType {
    const count = foundInVariants.length;
    if (count === 3) return PriorArtIntersectionType.I3;
    if (count === 2) return PriorArtIntersectionType.I2;
    return PriorArtIntersectionType.NONE;
  }

  /**
   * Create shortlist of top results
   */
  private async createShortlist(runId: string): Promise<void> {
    // Only shortlist patents that appear in at least 2 variants (intersection)
    const topResults = await prisma.priorArtUnifiedResult.findMany({
      where: {
        runId,
        // Only consider patents that appear in multiple variants
        OR: [
          { foundInVariants: { hasSome: ['broad', 'baseline'] } },
          { foundInVariants: { hasSome: ['broad', 'narrow'] } },
          { foundInVariants: { hasSome: ['baseline', 'narrow'] } },
          { foundInVariants: { hasEvery: ['broad', 'baseline', 'narrow'] } }
        ]
      },
      orderBy: [
        { score: 'desc' },
        { publicationNumber: 'asc' },
      ],
      take: 10, // Configurable
    });

    console.log(`📋 Shortlisting ${topResults.length} intersecting patents for detailed analysis`);

    for (const result of topResults) {
      await prisma.priorArtUnifiedResult.update({
        where: { id: result.id },
        data: { shortlisted: true },
      });
    }
  }

  /**
   * Helper methods
   */
  private async generateBundleHash(bundleId: string): Promise<string> {
    const bundle = await this.getApprovedBundle(bundleId);
    return require('crypto').createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  }

  private async getApprovedBundle(bundleId: string): Promise<PriorArtBundle & { patentId: string }> {
    const bundle = await prisma.priorArtSearchBundle.findUnique({
      where: { id: bundleId },
    });

    if (!bundle?.bundleData) {
      throw new Error('Bundle not found or not approved');
    }

    const bundleData = bundle.bundleData as unknown as PriorArtBundle;
    return {
      ...bundleData,
      patentId: bundle.patentId,
    };
  }

  /**
   * LEVEL 0: Local DB similarity check using LocalPatent. If conclusive, run novelty LLM and short-circuit.
   */
  private async executeLevel0LocalCheck(
    runId: string,
    bundle: PriorArtBundle & { patentId: string },
    jwtToken: string
  ): Promise<{ shortCircuit: boolean; determination?: string; reportUrl?: string; level0Results?: any } | null> {
    try {
      // Build a broad query joining core concepts and phrases
      const broadQuery = [
        bundle.source_summary.title,
        bundle.core_concepts.join(' '),
        bundle.phrases.join(' '),
        bundle.technical_features.join(' '),
      ].filter(Boolean).join(' ');

      const localTop = await this.searchLocal(broadQuery, 5); // Reduced from 15 to avoid token limits
      if (!localTop || localTop.length === 0) {
        await prisma.priorArtRun.update({ where: { id: runId }, data: { level0Checked: true } });
        return { shortCircuit: false };
      }

      // Convert to Level 1 patent format for novelty screening
      const level1Candidates = localTop.map((r: any) => ({
        publicationNumber: r.publication_number,
        title: r.title,
        abstract: r.snippet || '',
        relevance: 70, // heuristic baseline for local hits
        foundInVariants: ['level0_local'],
        intersectionType: 'NONE',
      }));

      try {
        const level1 = await NoveltyAssessmentService.performLevel1Assessment({
          patentId: bundle.patentId,
          runId,
          jwtToken,
          inventionSummary: {
            title: bundle.source_summary.title,
            problem: bundle.source_summary.problem_statement,
            solution: bundle.source_summary.solution_summary,
          },
          level1Patents: level1Candidates,
        });

        // Store level 0 results metadata
        await prisma.priorArtRun.update({
          where: { id: runId },
          data: {
            level0Checked: true,
            level0Determination: level1.determination,
            level0Results: level1.level1Results || {},
          },
        });

        if (level1.determination && level1.determination !== 'DOUBT') {
          // NOVEL or NOT_NOVEL: generate report (already triggered inside service; fetch last URL if available)
          return {
            shortCircuit: true,
            determination: level1.determination,
            level0Results: level1.level1Results,
          };
        }
      } catch (level0Error) {
        console.warn('⚠️ Level 0 LLM assessment failed, but local patents found will still be shown:', level0Error);

        // Even if LLM fails, store the local search results so they can be displayed
        const fallbackResults = {
          patent_assessments: level1Candidates.map(p => ({
            publication_number: p.publicationNumber,
            relevance: 'UNKNOWN', // Since LLM failed
            reasoning: 'Local patent found but novelty assessment failed'
          })),
          overall_determination: null,
          summary_remarks: 'Local search completed but LLM assessment failed'
        };

        await prisma.priorArtRun.update({
          where: { id: runId },
          data: {
            level0Checked: true,
            level0Determination: null,
            level0Results: fallbackResults,
          },
        });
      }

      return { shortCircuit: false };
    } catch (err) {
      console.warn('Level 0 local check error:', err);
      return null;
    }
  }

  private isRecent(date: Date): boolean {
    const ttlDays = parseInt(process.env.DETAILS_TTL_DAYS || '14');
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    return (Date.now() - date.getTime()) < ttlMs;
  }

  /**
   * Get Level 1 patents for novelty assessment (from search results only)
   */
  private async getLevel1PatentsForNovelty(runId: string): Promise<Array<{
    publicationNumber: string;
    title: string;
    abstract: string;
    relevance: number;
    foundInVariants: string[];
    intersectionType: string;
  }>> {
    try {
      // Get unified results for this run (Level 1 data)
      const unifiedResults = await prisma.priorArtUnifiedResult.findMany({
        where: { runId },
        orderBy: { score: 'desc' },
        take: 25, // Analyze top 25 most relevant patents
      });

      const level1Patents: Array<{
        publicationNumber: string;
        title: string;
        abstract: string;
        relevance: number;
        foundInVariants: string[];
        intersectionType: string;
      }> = [];

      for (const result of unifiedResults) {
        // Get patent data from search results (Level 1 data)
        const patentData = await prisma.priorArtPatent.findUnique({
          where: { publicationNumber: result.publicationNumber },
          select: {
            title: true,
            abstract: true,
          }
        });

        if (patentData && patentData.title && patentData.abstract) {
          level1Patents.push({
            publicationNumber: result.publicationNumber,
            title: patentData.title,
            abstract: patentData.abstract,
            relevance: result.score ? Math.round(Number(result.score) * 100) : 0,
            foundInVariants: result.foundInVariants,
            intersectionType: result.intersectionType,
          });
        }
      }

      console.log(`📊 Collected ${level1Patents.length} Level 1 patents for novelty analysis`);
      return level1Patents;
    } catch (error) {
      console.error('Error getting Level 1 patents for novelty:', error);
      return [];
    }
  }

  /**
   * Get intersecting patents for novelty assessment (returns full metadata)
   */
  private async getIntersectingPatentsForNovelty(runId: string): Promise<Array<{
    publicationNumber: string;
    title: string;
    abstract: string;
    relevance: number;
    foundInVariants: string[];
    intersectionType: string;
  }>> {
    try {
      // Get unified results for this run
      const unifiedResults = await prisma.priorArtUnifiedResult.findMany({
        where: { runId },
        orderBy: { score: 'desc' },
        take: 20, // Limit to top 20 most relevant patents
      });

      const intersectingPatents: Array<{
        publicationNumber: string;
        title: string;
        abstract: string;
        relevance: number;
        foundInVariants: string[];
        intersectionType: string;
      }> = [];

      for (const result of unifiedResults) {
        // Only include patents that were shortlisted or have high intersection
        if (result.shortlisted || result.intersectionType === 'I2' || result.intersectionType === 'I3') {
          const patentData = await prisma.priorArtPatent.findUnique({
            where: { publicationNumber: result.publicationNumber },
            select: {
              title: true,
              abstract: true,
            }
          });

          if (patentData && patentData.title && patentData.abstract) {
            intersectingPatents.push({
              publicationNumber: result.publicationNumber,
              title: patentData.title,
              abstract: patentData.abstract,
              relevance: result.score ? Math.round(Number(result.score) * 100) : 0,
              foundInVariants: result.foundInVariants,
              intersectionType: result.intersectionType,
            });
          }
        }
      }

      return intersectingPatents;
    } catch (error) {
      console.error('Error getting intersecting patents for novelty:', error);
      return [];
    }
  }

  /**
   * Extract scholarly article data from SerpAPI result
   */
  private extractScholarData(result: any): {
    title: string;
    authors: string[];
    publication: string;
    year?: number;
    abstract: string;
    citationCount: number;
    link: string;
    pdfLink: string;
    doi: string;
  } {
    if (!result) {
      return {
        title: '',
        authors: [],
        publication: '',
        // year: undefined, // Omit for now
        abstract: '',
        citationCount: 0,
        link: '',
        pdfLink: '',
        doi: '',
      };
    }

    // Parse Google Scholar result format
    // Note: Google Scholar API returns different fields than patents
    const title = result.title || '';
    const authors = result.authors ? result.authors.split(',').map((a: string) => a.trim()) : [];
    const publication = result.publication || result.journal || '';
    const year = result.year ? parseInt(result.year) : undefined;
    const abstract = result.snippet || result.abstract || '';
    const citationCount = result.cited_by ? parseInt(result.cited_by.value || '0') : 0;
    const link = result.link || result.url || '';
    const pdfLink = result.pdf_link || result.pdf || '';
    const doi = result.doi || '';

    return {
      title,
      authors,
      publication,
      year,
      abstract,
      citationCount,
      link,
      pdfLink,
      doi,
    };
  }
}

export const priorArtSearchService = new PriorArtSearchService();
