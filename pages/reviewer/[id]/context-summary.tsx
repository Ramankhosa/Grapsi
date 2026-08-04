// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import axios from 'axios';
import { FaSpinner, FaCheckCircle, FaExclamationTriangle, FaCircle, FaArrowLeft } from 'react-icons/fa';
import Head from 'next/head';
import Link from 'next/link';
import ContextSummaryView from '../../../components/ContextSummaryView';
import ReviewerShell from '@/components/reviewer/ReviewerShell';

type SectionStatus = {
  id: string;
  title: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
  context_summary?: string;
  version?: number;
};

enum ProcessStage {
  INITIALIZING = 'Initializing',
  GENERATING_SUMMARIES = 'Generating Context Summaries',
  COMPLETED = 'Context Summary Generation Completed',
  ERROR = 'Error'
}

export default function ContextSummaryGeneration() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  const [callData, setCallData] = useState<any>(null);
  const [sections, setSections] = useState<SectionStatus[]>([]);
  const [currentStage, setCurrentStage] = useState<ProcessStage>(ProcessStage.INITIALIZING);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [processLog, setProcessLog] = useState<string[]>([]);
  const [showContextSummaries, setShowContextSummaries] = useState(true);
  const [isResettingReviews, setIsResettingReviews] = useState(false);
  
  // Add log entry with timestamp
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setProcessLog(prev => [...prev, `[${timestamp}] ${message}`]);
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
      addLog('Initializing context summary generation...');
      
      // Fetch call data
      const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
      setCallData(callResponse.data);
      
      // Fetch sections
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      const fetchedSections = sectionsResponse.data.sections || [];
      
      // Initialize sections status
      const initialSections = fetchedSections.map(section => ({
        id: section.id,
        title: section.section_title,
        status: section.context_summary ? 'completed' : 'pending' as const,
        context_summary: section.context_summary,
        version: section.version
      }));
      
      setSections(initialSections);
      
      const existingSummaries = initialSections.filter(s => s.context_summary).length;
      const totalSections = initialSections.length;
      
      addLog(`Found ${totalSections} sections to process`);
      addLog(`${existingSummaries} sections already have context summaries`);
      
      if (existingSummaries === totalSections) {
        addLog('All sections already have context summaries');
        setCurrentStage(ProcessStage.COMPLETED);
        setProgress(100);
      } else {
        // Start generating context summaries
        addLog(`Need to generate ${totalSections - existingSummaries} context summaries`);
        setCurrentStage(ProcessStage.GENERATING_SUMMARIES);
        await generateContextSummaries(initialSections);
      }
      
    } catch (error) {
      console.error('Error initializing process:', error);
      setError('Failed to initialize the context summary generation process. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to initialize process');
    }
  };

  // Generate context summaries for all sections
  const generateContextSummaries = async (sectionsList: SectionStatus[]) => {
    addLog('Starting context summary generation...');
    let completedCount = 0;
    
    // Calculate initial progress based on already completed summaries
    const initiallyCompleted = sectionsList.filter(s => s.status === 'completed').length;
    if (initiallyCompleted > 0) {
      completedCount = initiallyCompleted;
      setProgress((initiallyCompleted / sectionsList.length) * 100);
    }
    
    try {
      // Process each section that doesn't have a summary yet
      for (const section of sectionsList) {
        // Skip already completed sections
        if (section.status === 'completed') {
          addLog(`Section ${section.title} already has a context summary - skipping`);
          continue;
        }
        
        addLog(`Generating context summary for section: ${section.title}`);
        
        // Update section status to processing
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
          setProgress((completedCount / sectionsList.length) * 100);
          
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
      
      // Mark process as completed
      addLog('Context summary generation completed.');
      setCurrentStage(ProcessStage.COMPLETED);
      setProgress(100);
      
    } catch (error) {
      console.error('Error in context summary generation:', error);
      setError('Failed to generate context summaries. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to complete context summary generation');
    }
  };

  // Regenerate ALL context summaries regardless of current state
  const regenerateAllSummaries = async () => {
    try {
      setCurrentStage(ProcessStage.INITIALIZING);
      addLog('Initializing regeneration of ALL context summaries...');
      
      // Fetch call data if not already loaded
      if (!callData) {
        const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
        setCallData(callResponse.data);
      }
      
      // Fetch sections
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      const fetchedSections = sectionsResponse.data.sections || [];
      
      // Initialize all sections as pending, regardless of existing summaries
      const initialSections = fetchedSections.map(section => ({
        id: section.id,
        title: section.section_title,
        status: 'pending' as const,
        context_summary: null, // Clear existing summaries
        version: section.version
      }));
      
      setSections(initialSections);
      setProgress(0);
      
      addLog(`Found ${initialSections.length} sections to regenerate`);
      setCurrentStage(ProcessStage.GENERATING_SUMMARIES);
      
      // Process each section
      let completedCount = 0;
      
      for (const section of initialSections) {
        addLog(`Regenerating context summary for section: ${section.title}`);
        
        // Update section status to processing
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
          setProgress((completedCount / initialSections.length) * 100);
          
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
          
          addLog(`Error regenerating context for section: ${section.title}`);
        }
      }
      
      // Mark process as completed
      addLog('Context summary regeneration completed.');
      setCurrentStage(ProcessStage.COMPLETED);
      setProgress(100);
      
    } catch (error) {
      console.error('Error regenerating context summaries:', error);
      setError('Failed to regenerate context summaries. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to regenerate context summaries');
    }
  };

  // Retry generating context summaries for sections with errors
  const retryFailedSummaries = async () => {
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
    
    // Update progress
    const completedCount = sections.filter(s => s.status === 'completed').length;
    setProgress((completedCount / sections.length) * 100);
  };

  // Reset and rerun all section reviews
  const resetAndRerunAllReviews = async () => {
    try {
      setIsResettingReviews(true);
      addLog('Resetting all section reviews to draft status...');
      
      // Reset all section reviews to draft status
      await axios.post(`/api/reviewer/calls/${id}/reset-all-reviews`);
      
      addLog('All section reviews reset successfully.');
      addLog('Navigate to the Advanced Review page to rerun all section reviews.');
      
      // Show completion message
      setIsResettingReviews(false);
      
    } catch (error) {
      console.error('Error resetting section reviews:', error);
      setError('Failed to reset section reviews. Please try again.');
      setCurrentStage(ProcessStage.ERROR);
      addLog('Error: Failed to reset section reviews');
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
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Processing</span>;
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
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
      title="Context summaries"
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

      {/* Error message */}
      {error && currentStage === ProcessStage.ERROR && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6">
          <div className="flex">
            <FaExclamationTriangle className="h-5 w-5 text-red-500 mr-2" />
            <span>{error}</span>
          </div>
          <button
            onClick={retryFailedSummaries}
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
        </div>
        
        {showContextSummaries && (
          <div className="bg-white shadow rounded-lg p-4">
            {sections.filter(s => s.context_summary).length > 0 ? (
              <div className="space-y-4">
                {sections
                  .filter(s => s.context_summary)
                  .map(section => (
                    <div key={section.id} className="border rounded p-3">
                      <div className="flex items-center">
                        <h3 className="font-medium text-lg">{section.title}</h3>
                        {section.version && section.version > 1 && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-cobalt-100 text-cobalt-800">
                            v{section.version}
                          </span>
                        )}
                      </div>
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
                      {section.status === 'processing' && <FaSpinner className="text-purple-500 h-4 w-4 animate-spin" />}
                      {section.status === 'completed' && <FaCheckCircle className="text-green-500 h-4 w-4" />}
                      {section.status === 'error' && <FaExclamationTriangle className="text-red-500 h-4 w-4" />}
                    </span>
                    <div className="flex items-center">
                      <p className="text-nickel-800 font-medium">{section.title}</p>
                      {section.version && section.version > 1 && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-cobalt-100 text-cobalt-800">
                          v{section.version}
                        </span>
                      )}
                    </div>
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
        
        {(currentStage === ProcessStage.ERROR || currentStage === ProcessStage.INITIALIZING) && (
          <button 
            onClick={initializeProcess}
            className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
          >
            {currentStage === ProcessStage.ERROR ? 'Retry Generation' : 'Start Generation'}
          </button>
        )}
        
        {(currentStage === ProcessStage.COMPLETED) && (
          <div className="flex space-x-3">
            <button
              onClick={regenerateAllSummaries}
              className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
            >
              Regenerate All Summaries
            </button>
            
            <button
              onClick={resetAndRerunAllReviews}
              disabled={isResettingReviews}
              className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 disabled:opacity-50"
            >
              {isResettingReviews ? (
                <>
                  <FaSpinner className="inline-block mr-2 animate-spin" />
                  Resetting Reviews...
                </>
              ) : (
                "Reset All Reviews"
              )}
            </button>
            
            <Link href={`/reviewer/${id}/final-review-process`} className="nk-btn-primary nk-btn-sm">
              Continue to Advanced Review
            </Link>
          </div>
        )}
      </div>
    </ReviewerShell>
  );
}
