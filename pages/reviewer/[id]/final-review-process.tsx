// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import axios from 'axios';
import { FaSpinner, FaCheckCircle, FaExclamationTriangle, FaCircle, FaArrowLeft } from 'react-icons/fa';
import Head from 'next/head';
import Link from 'next/link';
import ContextSummaryView from '../../../components/ContextSummaryView';
import { SECTION_ORDER } from '@/lib/reviewer/sectionGrouping';
import ReviewerShell from '@/components/reviewer/ReviewerShell';

const SECTION_REVIEW_BATCH_SIZE = 1;
const SECTION_REVIEW_BATCH_DELAY_MS = 4000;
const SECTION_REVIEW_MAX_ATTEMPTS = 3;
const RATE_LIMIT_BUFFER_MS = 2000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function hasMeaningfulContent(value: unknown) {
  const text = String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[a-z0-9]/i.test(text);
}

function getRetryAfterMs(error: any) {
  const bodyValue = Number(error?.response?.data?.retryAfterMs);
  if (Number.isFinite(bodyValue) && bodyValue > 0) return bodyValue;

  const headerValue = Number(error?.response?.headers?.['retry-after']);
  if (Number.isFinite(headerValue) && headerValue > 0) return headerValue * 1000;

  return 60000;
}

function isReviewRateLimitError(error: any) {
  return error?.response?.status === 429 || error?.response?.data?.code === 'GEMINI_RATE_LIMITED';
}

type SectionStatus = {
  id: string;
  title: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
  context_summary?: string;
};

enum ProcessStage {
  INITIALIZING = 'Initializing',
  CHECKING_PREREQUISITES = 'Checking Context Summary Prerequisites',
  GENERATING_SUMMARIES = 'Generating Context Summaries',
  REVIEWING_SECTIONS = 'Reviewing Sections with Context',
  COMPLETED = 'Review Process Completed',
  ERROR = 'Error'
}

export default function FinalReviewProcess() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  const [callData, setCallData] = useState<any>(null);
  const [sections, setSections] = useState<SectionStatus[]>([]);
  const [currentStage, setCurrentStage] = useState<ProcessStage>(ProcessStage.INITIALIZING);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [processLog, setProcessLog] = useState<string[]>([]);
  const [showContextSummaries, setShowContextSummaries] = useState(false);
  const [missingSummaries, setMissingSummaries] = useState<string[]>([]);
  const [isGeneratingSummaries, setIsGeneratingSummaries] = useState(false);
  const [skipCompletedReviews, setSkipCompletedReviews] = useState(true);
  const [isResettingReviews, setIsResettingReviews] = useState(false);
  
  // Add log entry with timestamp
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setProcessLog(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Generate context summaries for all sections that are missing them
  const generateMissingSummaries = async () => {
    if (!id || missingSummaries.length === 0) return;
    
    try {
      setIsGeneratingSummaries(true);
      addLog(`Generating missing context summaries for ${missingSummaries.length} sections...`);
      
      const response = await axios.post(`/api/reviewer/calls/${id}/generate-all-context-summaries`);
      
      const { success_count: ready = 0, derived_count: derived = 0 } = response.data;
      addLog(
        derived > 0
          ? `Prepared ${ready} context summaries (${derived} derived without a model call, since no later section reads them).`
          : `Successfully generated ${ready} context summaries.`
      );
      
      // Refresh the page data
      await initializeProcess();
      
    } catch (error) {
      console.error('Error generating context summaries:', error);
      addLog('Error: Failed to generate all context summaries');
      setError('Failed to generate context summaries. Please try again.');
    } finally {
      setIsGeneratingSummaries(false);
    }
  };

  // Retry generating context summaries for sections with errors
  const retryContextSummaries = async () => {
    const failedSections = sections.filter(s => s.status === 'error');
    if (failedSections.length === 0) return;
    
    addLog(`Retrying context summary generation for ${failedSections.length} failed sections...`);
    
    for (const section of failedSections) {
      addLog(`Retrying context summary for section: ${section.title}`);
      
      // Update section status
      setSections(prev => 
        prev.map(s => s.id === section.id ? { ...s, status: 'processing' } : s)
      );
      
      try {
        // Call the API to generate context summary for this section
        const response = await axios.post(
          `/api/reviewer/calls/${id}/sections/${section.id}/generate-context-summary`
        );
        
        // Update section status with success
        setSections(prev => 
          prev.map(s => s.id === section.id ? { 
            ...s, 
            status: 'completed',
            context_summary: response.data.context_summary 
          } : s)
        );
        
        addLog(`Successfully generated context summary for: ${section.title}`);
      } catch (error) {
        console.error(`Error retrying context for section ${section.id}:`, error);
        
        // Update section status with error
        setSections(prev => 
          prev.map(s => s.id === section.id ? { 
            ...s, 
            status: 'error',
            message: 'Failed to generate context summary after retry' 
          } : s)
        );
        
        addLog(`Error retrying context for section: ${section.title}`);
      }
    }
  };

  // Initialize the process
  useEffect(() => {
    if (status === 'loading' || !id) return;
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    initializeProcess();
  }, [id, status, router]);
  
  const initializeProcess = async () => {
    try {
      setCurrentStage(ProcessStage.INITIALIZING);
      addLog('Initializing review process...');
      // Fetch call data
      const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
      setCallData(callResponse.data);
      
      // Fetch sections
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      const fetchedSections = sectionsResponse.data.sections || [];
      
      // Initialize sections status
      const initialSections = fetchedSections.filter(section => hasMeaningfulContent(section.user_input)).map(section => ({
        id: section.id,
        title: section.section_title,
        status: 'pending' as const,
        context_summary: section.context_summary
      }));
      
      setSections(initialSections);
      addLog(`Found ${initialSections.length} sections to process`);
      
      // Check if all sections have context summaries
      setCurrentStage(ProcessStage.CHECKING_PREREQUISITES);
      const missingSummaryTitles: string[] = [];
      
      initialSections.forEach(section => {
        if (!section.context_summary) {
          missingSummaryTitles.push(section.title);
        }
      });
      
      setMissingSummaries(missingSummaryTitles);
      
      if (missingSummaryTitles.length > 0) {
        addLog(`${missingSummaryTitles.length} sections are missing context summaries. They will be generated automatically for sections with content.`);
      }
      
      // Proceed to context summary generation phase (which should be quick since all summaries exist)
      setCurrentStage(ProcessStage.GENERATING_SUMMARIES);
      await generateContextSummaries(initialSections);
      
    } catch (error) {
      console.error('Error initializing process:', error);
      setError('Failed to initialize the review process. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to initialize process');
    }
  };

  // Generate context summaries for all sections
  const generateContextSummaries = async (sectionsList: SectionStatus[]) => {
    addLog('Starting context summary generation...');
    let completedCount = 0;
    
    try {
      // First, check if any sections already have context summaries
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      const fetchedSections = sectionsResponse.data.sections || [];
      
      // Process each section
      for (const section of sectionsList) {
        addLog(`Processing context summary for section: ${section.title}`);
        
        // Check if this section already has a context summary
        const existingSection = fetchedSections.find(s => s.id === section.id);
        if (existingSection && existingSection.context_summary) {
          addLog(`Using existing context summary for: ${section.title}`);
          
          // Update section status with existing summary
          setSections(prev => 
            prev.map(s => s.id === section.id ? { 
              ...s, 
              status: 'completed',
              context_summary: existingSection.context_summary 
            } : s)
          );
          
          completedCount++;
          setProgress((completedCount / sectionsList.length) * 50); // First 50% for summaries
          continue;
        }
        
        // Update section status
        setSections(prev => 
          prev.map(s => s.id === section.id ? { ...s, status: 'processing' } : s)
        );
        
        try {
          // Call the API to generate context summary for this section
          const response = await axios.post(
            `/api/reviewer/calls/${id}/sections/${section.id}/generate-context-summary`
          );
          
          // Update section status with success
          setSections(prev => 
            prev.map(s => s.id === section.id ? { 
              ...s, 
              status: 'completed',
              context_summary: response.data.context_summary 
            } : s)
          );
          
          addLog(`Completed context summary for: ${section.title}`);
          completedCount++;
          setProgress((completedCount / sectionsList.length) * 50); // First 50% for summaries
          
        } catch (error) {
          console.error(`Error generating context for section ${section.id}:`, error);
          
          // Update section status with error
          setSections(prev => 
            prev.map(s => s.id === section.id ? { 
              ...s, 
              status: 'error',
              message: 'Failed to generate context summary' 
            } : s)
          );
          
          addLog(`Error generating context for section: ${section.title}`);
        }
      }
      
      // Start section review process
      addLog('Context summaries generated. Starting section reviews...');
      setCurrentStage(ProcessStage.REVIEWING_SECTIONS);
      await reviewSectionsWithContext(sectionsList);
      
    } catch (error) {
      console.error('Error in context summary generation:', error);
      setError('Failed to generate context summaries. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to complete context summary generation');
    }
  };

  // Review sections in the specified order with context from previous sections
  const reviewSectionsWithContext = async (sectionsList: SectionStatus[]) => {
    // Reset the progress for the review phase
    setProgress(50); // Start at 50% (after summaries)
    let reviewedCount = 0;
    
    try {
      // Sort sections according to the predefined order
      const orderedSections = [...sectionsList].sort((a, b) => {
        const aIndex = SECTION_ORDER.indexOf(a.title);
        const bIndex = SECTION_ORDER.indexOf(b.title);
        
        // If section title not in order list, put at the end
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        
        return aIndex - bIndex;
      });
      
      addLog(`Ordered sections for review: ${orderedSections.map(s => s.title).join(', ')}`);
      
      // Check which sections already have reviews if we're skipping completed sections
      let sectionsToReview = orderedSections;
      
      if (skipCompletedReviews) {
        try {
          // Get existing section reviews
          const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
          const fetchedSections = sectionsResponse.data.sections || [];
          const reviewedSectionIds = new Set(
            fetchedSections
              .filter(s => s.status === 'reviewed' || s.status === 'revised')
              .map(s => s.id)
          );
          
          if (reviewedSectionIds.size > 0) {
            // Filter out sections that are already reviewed
            const pendingSections = orderedSections.filter(s => !reviewedSectionIds.has(s.id));
            if (pendingSections.length > 0) {
              addLog(`Skipping ${orderedSections.length - pendingSections.length} already reviewed sections. Will only review ${pendingSections.length} pending sections.`);
              sectionsToReview = pendingSections;
            } else {
              addLog('All sections are already reviewed. Skipping review process.');
              setProgress(100);
              setCurrentStage(ProcessStage.COMPLETED);
              return;
            }
          }
        } catch (error) {
          console.error('Error fetching existing section reviews:', error);
          addLog('Could not check for existing reviews, will process all sections.');
          // Fall back to reviewing all sections
        }
      } else {
        addLog('Force reviewing all sections, including those already reviewed.');
      }
      
      // Process sections in small batches after context summaries are available.
      // Keep the default batch size at 1 because dependency context is ordered and Gemini
      // can return provider-wide cooldowns that affect subsequent requests.
      for (let batchStart = 0; batchStart < sectionsToReview.length; batchStart += SECTION_REVIEW_BATCH_SIZE) {
        const batch = sectionsToReview.slice(batchStart, batchStart + SECTION_REVIEW_BATCH_SIZE);
        addLog(`Starting review batch ${Math.floor(batchStart / SECTION_REVIEW_BATCH_SIZE) + 1} with ${batch.length} section(s).`);

        for (const section of batch) {
          addLog(`Starting review for section: ${section.title}`);
          
          // Update section status
          setSections(prev => 
            prev.map(s => s.id === section.id ? { ...s, status: 'processing' } : s)
          );
          
          try {
            let response;

            for (let attempt = 1; attempt <= SECTION_REVIEW_MAX_ATTEMPTS; attempt++) {
              try {
                response = await axios.post(
                  `/api/reviewer/calls/${id}/section-review-with-dependencies`,
                  { sectionId: section.id }
                );
                break;
              } catch (attemptError) {
                if (isReviewRateLimitError(attemptError) && attempt < SECTION_REVIEW_MAX_ATTEMPTS) {
                  const waitMs = getRetryAfterMs(attemptError) + RATE_LIMIT_BUFFER_MS;
                  addLog(`Rate limit while reviewing ${section.title}. Waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt + 1}/${SECTION_REVIEW_MAX_ATTEMPTS}.`);
                  await sleep(waitMs);
                  continue;
                }
                throw attemptError;
              }
            }

            if (!response) {
              throw new Error('Review did not return a response');
            }
            
            // Update section status with success
            setSections(prev => 
              prev.map(s => s.id === section.id ? { 
                ...s, 
                status: 'completed',
                context_summary: response.data.context_summary
              } : s)
            );
            
            if (response.data.used_dependency_sections?.length > 0) {
              addLog(`Completed review for section: ${section.title} (used context from: ${response.data.used_dependency_sections.join(', ')})`);
            } else {
              addLog(`Completed review for section: ${section.title} (no prior context used)`);
            }
            
            reviewedCount++;
            
            // Calculate progress based on total sections (not just pending ones)
            const reviewProgress = 50 + (reviewedCount / sectionsToReview.length) * 50;
            setProgress(reviewProgress);
            
          } catch (error) {
            console.error(`Error reviewing section ${section.id}:`, error);
            
            // Update section status with error
            setSections(prev => 
              prev.map(s => s.id === section.id ? { 
                ...s, 
                status: 'error',
                message: 'Failed to review section with context' 
              } : s)
            );
            
            addLog(`Error reviewing section: ${section.title}`);
          }
        }

        if (batchStart + SECTION_REVIEW_BATCH_SIZE < sectionsToReview.length) {
          addLog(`Batch complete. Waiting ${Math.ceil(SECTION_REVIEW_BATCH_DELAY_MS / 1000)}s before the next review batch.`);
          await sleep(SECTION_REVIEW_BATCH_DELAY_MS);
        }
      }
      
      // Mark process as completed
      addLog('Section reviews completed with context summaries.');
      setCurrentStage(ProcessStage.COMPLETED);
      
    } catch (error) {
      console.error('Error in section review process:', error);
      setError('Failed to complete section reviews. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to complete section reviews');
    }
  };

  // Reset and rerun all section reviews
  const resetAndRerunAllReviews = async () => {
    try {
      setIsResettingReviews(true);
      addLog('Resetting all section reviews to draft status...');
      
      // Reset all section reviews to draft status
      await axios.post(`/api/reviewer/calls/${id}/reset-all-reviews`);
      
      addLog('All section reviews reset successfully. Starting review process...');
      
      // Refresh sections data
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      const fetchedSections = sectionsResponse.data.sections || [];
      
      // Initialize sections status
      const initialSections = fetchedSections.map(section => ({
        id: section.id,
        title: section.section_title,
        status: 'pending' as const,
        context_summary: section.context_summary
      }));
      
      setSections(initialSections);
      setProgress(50); // Start at 50% (after summaries)
      
      // Force reviewing all sections, even those that were previously reviewed
      setSkipCompletedReviews(false);
      setCurrentStage(ProcessStage.REVIEWING_SECTIONS);
      
      // Start the review process
      await reviewSectionsWithContext(initialSections);
      
    } catch (error) {
      console.error('Error resetting and rerunning reviews:', error);
      setError('Failed to reset and rerun section reviews. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to reset and rerun section reviews');
    } finally {
      setIsResettingReviews(false);
    }
  };

  // Progress indicator color based on current stage
  const getProgressColor = () => {
    switch (currentStage) {
      case ProcessStage.ERROR:
        return 'bg-red-600';
      case ProcessStage.COMPLETED:
        return 'bg-cobalt-600';
      default:
        return 'bg-cobalt-600';
    }
  };

  // Status badge for sections
  const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-nickel-100 text-nickel-800">Pending</span>;
      case 'processing':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cobalt-100 text-cobalt-800">Processing</span>;
      case 'completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Completed</span>;
      case 'error':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Error</span>;
      default:
        return null;
    }
  };

  if (status === 'loading' || !id) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        <div className="ml-3">Loading...</div>
      </div>
    );
  }

  // This page reshapes sections for its own progress list; the shared nav wants
  // the API's own field names back.
  const railSections = sections.map(s => ({ ...s, section_title: s.title }));

  return (
    <ReviewerShell
      call={callData?.call || { id }}
      sections={railSections}
      title="Review all sections"
    >
      {/* Progress indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="nk-eyebrow">Current stage: {currentStage}</span>
          <span className="nk-mono text-nickel-500">{Math.round(progress)}% complete</span>
        </div>
        <div className="nk-meter">
          <div
            className={`h-full rounded-full ${getProgressColor()} transition-all duration-500 ease-in-out`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Missing context summaries warning */}
      {missingSummaries.length > 0 && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6">
          <div className="flex">
            <FaExclamationTriangle className="h-5 w-5 text-yellow-500 mr-2" />
            <div>
              <p className="font-medium">Context summaries required</p>
              <p className="mt-1">The following {missingSummaries.length} sections are missing context summaries: <span className="font-medium">{missingSummaries.join(', ')}</span></p>
              <p className="mt-1">Please generate them before proceeding with the review process.</p>
              <button
                onClick={generateMissingSummaries}
                disabled={isGeneratingSummaries}
                className="mt-2 px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50"
              >
                {isGeneratingSummaries ? (
                  <>
                    <FaSpinner className="inline-block mr-2 animate-spin" />
                    Generating Context Summaries...
                  </>
                ) : (
                  "Generate Missing Context Summaries"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Error message */}
      {error && currentStage === ProcessStage.ERROR && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6">
          <div className="flex">
            <FaExclamationTriangle className="h-5 w-5 text-red-500 mr-2" />
            <span>{error}</span>
          </div>
          <button
            onClick={retryContextSummaries}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry Failed Sections
          </button>
        </div>
      )}
      
      {/* Context summaries */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold">Context Summaries</h2>
            <button
              onClick={() => setShowContextSummaries(!showContextSummaries)}
              className="ml-4 px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
            >
              {showContextSummaries ? 'Hide Context Summaries' : 'Show Context Summaries'}
            </button>
          </div>
          
          {currentStage !== ProcessStage.INITIALIZING && (
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  setSkipCompletedReviews(!skipCompletedReviews);
                  addLog(`${skipCompletedReviews ? 'Will force review all sections' : 'Will skip already reviewed sections'}`);
                }}
                className={`px-4 py-2 ${skipCompletedReviews ? 'bg-gray-600' : 'bg-yellow-600'} text-white rounded hover:${skipCompletedReviews ? 'bg-gray-700' : 'bg-yellow-700'}`}
              >
                {skipCompletedReviews ? 'Override: Review All Sections' : 'Skip Completed Sections'}
              </button>
            </div>
          )}
        </div>
        
        {showContextSummaries && (
          <div className="bg-white shadow rounded-lg p-4">
            {sections.filter(s => s.context_summary).length > 0 ? (
              <div className="space-y-4">
                {sections
                  .filter(s => s.context_summary)
                  .map(section => (
                    <div key={section.id} className="border rounded p-3">
                      <h3 className="font-medium text-lg">{section.title}</h3>
                      <div className="bg-nickel-50 p-3 rounded text-sm mt-2">
                        <h4 className="font-medium mb-1 text-nickel-700">Context Summary:</h4>
                        <p className="whitespace-pre-wrap">{section.context_summary}</p>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-nickel-500 text-center py-4">
                No context summaries have been generated yet.
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* Sections status */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Section Status</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-nickel-200">
            {sections.map((section) => (
              <li key={section.id} className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="mr-3">
                      {section.status === 'pending' && <FaCircle className="text-nickel-400 h-4 w-4" />}
                      {section.status === 'processing' && <FaSpinner className="text-blue-500 h-4 w-4 animate-spin" />}
                      {section.status === 'completed' && <FaCheckCircle className="text-green-500 h-4 w-4" />}
                      {section.status === 'error' && <FaExclamationTriangle className="text-red-500 h-4 w-4" />}
                    </span>
                    <p className="text-nickel-800 font-medium">{section.title}</p>
                  </div>
                  <div className="flex items-center">
                    <StatusBadge status={section.status} />
                    {!section.context_summary && (
                      <span className="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full">
                        Missing Context
                      </span>
                    )}
                  </div>
                </div>
                {section.message && (
                  <p className="mt-1 text-sm text-red-600">{section.message}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      
      {/* Process log */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Process Log</h2>
        </div>
        <div className="bg-gray-800 text-gray-200 p-4 rounded-md font-mono text-sm h-64 overflow-y-auto">
          {processLog.map((log, index) => (
            <div key={index} className="mb-1">{log}</div>
          ))}
        </div>
      </div>
      
      {/* Navigation buttons */}
      <div className="flex justify-between mt-8">
        <Link href={`/reviewer/${id}`} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
          Back to Project
        </Link>
        
        {(currentStage === ProcessStage.COMPLETED) && (
          <div className="flex space-x-3">
            <button
              onClick={resetAndRerunAllReviews}
              disabled={isResettingReviews}
              className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 disabled:opacity-50"
            >
              {isResettingReviews ? (
                <>
                  <FaSpinner className="inline-block mr-2 animate-spin" />
                  Rerunning All Reviews...
                </>
              ) : (
                "Rerun All Section Reviews"
              )}
            </button>
            
            <Link href={`/reviewer/${id}/final-review`} className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700">
              View Final Review
            </Link>
          </div>
        )}
        
        {(currentStage === ProcessStage.CHECKING_PREREQUISITES || currentStage === ProcessStage.INITIALIZING) && missingSummaries.length === 0 && (
          <button 
            onClick={() => initializeProcess()}
            className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
          >
            Start Review Process
          </button>
        )}
        
        {/* Add a button to regenerate context summaries without full review */}
        {currentStage === ProcessStage.CHECKING_PREREQUISITES && missingSummaries.length === 0 && (
          <button
            onClick={async () => {
              setCurrentStage(ProcessStage.GENERATING_SUMMARIES);
              setProgress(0);
              await generateContextSummaries(sections);
              // Stop after generating context summaries
              setCurrentStage(ProcessStage.CHECKING_PREREQUISITES);
              setProgress(50);
              addLog('Context summaries updated. Stopped after summary generation.');
            }}
            className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
          >
            Update Context Summaries Only
          </button>
        )}
      </div>
    </ReviewerShell>
  );
}
