// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaSpinner, FaCheck, FaTimes, FaEdit, FaPlus, FaFileExport, FaFileUpload, FaClipboardCheck, FaFileAlt, FaRobot, FaCheckCircle, FaInfoCircle, FaCircle, FaChevronDown, FaChevronUp } from "react-icons/fa";
import ReviewRevisionButton from "../../components/ReviewRevisionButton";
import ReviewerSectionsNav from '../../components/ReviewerSectionsNav';

type ReviewerCall = {
  id: string;
  project_title: string;
  agency_name: string;
  call_input_type: string;
  parsed_json: any;
  LLM_model_used: string;
  review_status: string;
  created_at: string;
  overall_review_json?: any;
};

type ReviewerSection = {
  id: string;
  call_id: string;
  section_title: string;
  user_input: string;
  ai_review_json: any;
  last_reviewed_at: string;
  status: string;
  version: number;
  context_summary?: string;
};

interface ReviewProgressState {
  last_reviewed_section: string;
  last_reviewed_section_id: string;
  timestamp: string;
}

export default function ReviewerCallDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id } = router.query;
  
  const [call, setCall] = useState<ReviewerCall | null>(null);
  const [sections, setSections] = useState<ReviewerSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Add state for tracking final review process
  const [finalReviewLoading, setFinalReviewLoading] = useState(false);
  const [finalReviewError, setFinalReviewError] = useState("");
  const [finalReviewComplete, setFinalReviewComplete] = useState(false);
  const [finalReviewGenerated, setFinalReviewGenerated] = useState(false);
  
  const [reviewingSections, setReviewingSections] = useState<Record<string, boolean>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  
  const [reviewProgressState, setReviewProgressState] = useState<ReviewProgressState | null>(null);
  
  // Access parsed JSON directly from the call object
  const parsedData = call?.parsed_json || {};
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);
  
  // Define a function to fetch sections separately
  const fetchSections = async () => {
    if (!id) return;
    
    try {
      const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
      setSections(sectionsResponse.data.sections || []);
    } catch (err) {
      console.error("Error fetching sections:", err);
      setError("Failed to fetch sections");
    }
  };
  
  // Fetch call details
  const fetchCallDetails = async () => {
    if (!id || status !== "authenticated") return;
    
    try {
      setLoading(true);
      
      // Fetch the call info
      const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
      setCall(callResponse.data.call);

      // Check if final review is complete
      const hasOverallReview = callResponse.data.call.overall_review_json != null;
      setFinalReviewComplete(hasOverallReview);
      setFinalReviewGenerated(hasOverallReview);
      
      // Load review progress state if available
      if (callResponse.data.call.review_progress_state) {
        setReviewProgressState(callResponse.data.call.review_progress_state);
      }
      
      // Fetch sections
      await fetchSections();
      
      setLoading(false);
    } catch (err) {
      console.error("Error fetching call details:", err);
      setError("Failed to load project details");
      
      // If unauthorized or not found, redirect
      if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 404)) {
        router.push("/reviewer");
      }
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch call details on mount
  useEffect(() => {
    fetchCallDetails();
  }, [id, status, router]);
  
  // No longer needed for collapsible section
  // useEffect(() => {
  //   // Set initial state based on screen size
  //   setShowFundingCall(window.innerWidth >= 768);
  // }, []);
  
  // Check if the call has a final review already
  useEffect(() => {
    if (call?.overall_review_json) {
      setFinalReviewComplete(true);
    }
  }, [call]);
  
  // Add function to handle final review generation
  const handleFinalReview = async () => {
    if (!id) return;
    
    try {
      setFinalReviewLoading(true);
      setFinalReviewError("");
      
      await axios.post(`/api/reviewer/calls/${id}/final-review`);
      
      // Refresh the page data to show the final review
      const response = await axios.get(`/api/reviewer/calls/${id}`);
      setCall(response.data.call);
      setFinalReviewComplete(true);
      setFinalReviewGenerated(true);
    } catch (err) {
      console.error("Error generating final review:", err);
      setFinalReviewError("Failed to generate final review. Please ensure you have at least one reviewed section.");
    } finally {
      setFinalReviewLoading(false);
    }
  };
  
  // Helper to check if any section is reviewed
  const hasReviewedSections = sections.some(section => section.status === "reviewed");
  
  // Function to handle reviewing a specific section
  const handleReviewSection = async (sectionId: string) => {
    if (reviewingSections[sectionId]) return;
    
    try {
      // Set this section as currently reviewing
      setReviewingSections(prev => ({ ...prev, [sectionId]: true }));
      
      // Clear any previous errors for this section
      setReviewErrors(prev => ({ ...prev, [sectionId]: '' }));
      
      // Call the API to review the section
      await axios.post(`/api/reviewer/calls/${id}/sections/${sectionId}/review`);
      
      // After successful review, refresh the sections to show updated status
      fetchSections();
    } catch (err: any) {
      console.error("Error reviewing section:", err);
      setReviewErrors(prev => ({ 
        ...prev, 
        [sectionId]: err.response?.data?.error || 'Failed to review section'
      }));
    } finally {
      // Mark the section as no longer reviewing
      setReviewingSections(prev => ({ ...prev, [sectionId]: false }));
    }
  };
  
  // Function to resume review from last point
  const handleResumeReview = () => {
    if (reviewProgressState?.last_reviewed_section_id) {
      // Navigate to the next section to review
      router.push(`/reviewer/${id}/section/${reviewProgressState.last_reviewed_section_id}`);
    }
  };
  
  // Function to restart review process
  const handleRestartReview = async () => {
    try {
      // Clear the review progress state
      await axios.post(`/api/reviewer/calls/${id}/reset-review-progress`);
      setReviewProgressState(null);
      
      // Navigate to the first section (Abstract)
      const abstractSection = sections.find(section => 
        section.section_title.toLowerCase().includes('abstract')
      );
      
      if (abstractSection) {
        router.push(`/reviewer/${id}/section/${abstractSection.id}`);
      } else if (sections.length > 0) {
        // If no Abstract section, go to the first section
        router.push(`/reviewer/${id}/section/${sections[0].id}`);
      }
    } catch (err) {
      console.error("Error resetting review progress:", err);
      setError("Failed to reset review progress");
    }
  };
  
  // Prepare navigation sections for ReviewerSectionsNav
  const navSections = sections.map(section => ({
    id: section.id,
    title: section.section_title,
    href: `/reviewer/${id}/section/${section.id}`,
    status: section.status as 'draft' | 'reviewed' | 'revised',
    isActive: router.asPath === `/reviewer/${id}/section/${section.id}`
  }));
  
  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-red-600">Error</h2>
          <p className="mt-2">{error}</p>
          <Link 
            href="/reviewer" 
            className="mt-4 inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }
  
  if (!call) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold">Project Not Found</h2>
          <p className="mt-2">The requested project could not be found.</p>
          <Link 
            href="/reviewer" 
            className="mt-4 inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>{call.project_title} - AI Grant Reviewer</title>
        <meta
          name="description"
          content={`Review analysis for ${call.project_title}`}
        />
      </Head>
      
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-800 to-blue-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{call.project_title}</h1>
              <p className="mt-1 text-blue-100">
                {call.agency_name}
              </p>
            </div>
            <Link 
              href="/reviewer"
              className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
            >
              <FaArrowLeft className="mr-2" />
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Sidebar - Project Sections */}
          <div className="lg:col-span-1">
            {/* Project Sections */}
            <div className="bg-white rounded-lg shadow mb-6">
              <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                <h2 className="text-lg font-semibold text-blue-900 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  Project Sections
                </h2>
              </div>
              
              <div className="p-4">
                {/* Call Analysis Button */}
                <Link
                  href={`/reviewer/${id}/call-analysis`}
                  className="mb-4 flex items-center justify-center w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  View Call Rules
                </Link>

                {/* Section List */}
                <div className="space-y-1">
                  {navSections.map((section) => (
                    <Link
                      key={section.id}
                      href={section.href}
                      className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                        section.isActive
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center">
                        <span className="font-medium">{section.title}</span>
                        {/* Add version badge if version > 1 */}
                        {sections.find(s => s.id === section.id)?.version > 1 && (
                          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                            section.isActive ? 'bg-blue-300 text-blue-900' : 'bg-blue-100 text-blue-800'
                          }`}>
                            v{sections.find(s => s.id === section.id)?.version}
                          </span>
                        )}
                      </div>
                      {section.status && (
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          section.status === 'reviewed' 
                            ? 'bg-green-100 text-green-800 border-green-200' 
                            : section.status === 'revised'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {section.status.charAt(0).toUpperCase() + section.status.slice(1)}
                        </span>
                      )}
                    </Link>
                  ))}
                  
                  <Link
                    href={`/reviewer/${id}/section/new`}
                    className="flex items-center justify-center mt-3 p-2 rounded-lg border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors"
                  >
                    <FaPlus className="mr-2" /> Add New Section
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Additional Actions */}
            <div className="bg-white rounded-lg shadow mb-6">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Additional Actions
                </h2>
              </div>
              
              <div className="p-4 space-y-2">
                <Link
                  href={`/reviewer/${id}/edit`}
                  className="flex items-center justify-center w-full px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                >
                  <FaEdit className="mr-2" /> Edit Project Details
                </Link>
              </div>
            </div>
          </div>
          
          {/* Main content - Review Process Steps */}
          <div className="lg:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Step 1 */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-gradient-to-r from-green-600 to-green-500 py-3 px-4">
                  <h2 className="text-xl font-bold text-white">Step 1</h2>
                </div>
                <div className="p-5">
                  <div className="flex items-center mb-4">
                    <div className="bg-green-100 rounded-full p-2 mr-3">
                      <FaCheck className="text-green-600 w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold">Add Project Sections</h3>
                  </div>
                  
                  <p className="text-gray-600 mb-4">
                    Import your whole proposal at once and let it split into the sections this call
                    requires, or add sections one at a time.
                  </p>

                  <div className="mt-2 text-sm text-gray-500">
                    {sections.length > 0 ? (
                      <p className="text-green-600 font-medium">{sections.length} section(s) added</p>
                    ) : (
                      <p>No sections added yet</p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/reviewer/${id}/import-proposal`}
                      className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                    >
                      <FaFileUpload className="mr-2" /> Import Full Proposal
                    </Link>
                    <Link
                      href={`/reviewer/${id}/section/new`}
                      className="inline-flex items-center px-4 py-2 bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
                    >
                      <FaPlus className="mr-2" /> Add One Section
                    </Link>
                  </div>
                </div>
              </div>
              
              {/* Step 2 */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-gradient-to-r from-purple-600 to-purple-500 py-3 px-4">
                  <h2 className="text-xl font-bold text-white">Step 2</h2>
                </div>
                <div className="p-5">
                  <div className="flex items-center mb-4">
                    <div className="bg-purple-100 rounded-full p-2 mr-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold">Generate Context Summaries</h3>
                  </div>
                  
                  <p className="text-gray-600 mb-4">Create context summaries for each section to enable advanced review.</p>
                  
                  <div className="mt-2 text-sm text-gray-500">
                    {sections.some(s => s.context_summary) ? (
                      <p className="text-purple-600 font-medium">Context summaries generated</p>
                    ) : (
                      <p>No context summaries yet</p>
                    )}
                  </div>
                  
                  <div className="mt-4">
                    <Link
                      href={`/reviewer/${id}/context-summary`}
                      className={`inline-flex items-center px-4 py-2 rounded ${
                        sections.length === 0 
                          ? 'bg-gray-300 text-gray-500 pointer-events-none' 
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                      onClick={e => {
                        if (sections.length === 0) {
                          e.preventDefault();
                        }
                      }}
                    >
                      Generate Context Summaries
                    </Link>
                  </div>
                </div>
              </div>
              
              {/* Step 3 */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-gradient-to-r from-teal-600 to-teal-500 py-3 px-4">
                  <h2 className="text-xl font-bold text-white">Step 3</h2>
                </div>
                <div className="p-5">
                  <div className="flex items-center mb-4">
                    <div className="bg-teal-100 rounded-full p-2 mr-3">
                      <FaRobot className="text-teal-600 w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold">Run Advanced Review Process</h3>
                  </div>
                  
                  <p className="text-gray-600 mb-4">Review sections with context dependencies for comprehensive analysis.</p>
                  
                  <div className="mt-2 text-sm text-gray-500">
                    {hasReviewedSections ? (
                      <p className="text-teal-600 font-medium">Sections reviewed</p>
                    ) : (
                      <p>No sections reviewed yet</p>
                    )}
                  </div>
                  
                  <div className="mt-4">
                    <Link
                      href={`/reviewer/${id}/final-review-process`}
                      className={`inline-flex items-center px-4 py-2 rounded ${
                        sections.length === 0
                          ? 'bg-gray-300 text-gray-500 pointer-events-none' 
                          : 'bg-teal-600 text-white hover:bg-teal-700'
                      }`}
                      onClick={e => {
                        if (sections.length === 0) {
                          e.preventDefault();
                        }
                      }}
                    >
                      Start Advanced Review
                    </Link>
                  </div>
                </div>
              </div>
              
              {/* Step 4 */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-gradient-to-r from-amber-600 to-amber-500 py-3 px-4">
                  <h2 className="text-xl font-bold text-white">Step 4</h2>
                </div>
                <div className="p-5">
                  <div className="flex items-center mb-4">
                    <div className="bg-amber-100 rounded-full p-2 mr-3">
                      <FaClipboardCheck className="text-amber-600 w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold">Generate Final Review</h3>
                  </div>
                  
                  <p className="text-gray-600 mb-4">Create a comprehensive final review with scores and recommendations.</p>
                  
                  <div className="mt-2 text-sm text-gray-500">
                    {finalReviewComplete ? (
                      <p className="text-amber-600 font-medium">Final review completed</p>
                    ) : (
                      <p>Final review not generated yet</p>
                    )}
                  </div>
                  
                  <div className="mt-4">
                    {hasReviewedSections && !finalReviewComplete && (
                      <button
                        onClick={handleFinalReview}
                        disabled={finalReviewLoading}
                        className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-amber-300 transition-colors"
                      >
                        {finalReviewLoading ? (
                          <>
                            <FaSpinner className="animate-spin mr-2" />
                            Generating...
                          </>
                        ) : (
                          <>
                            Generate Final Review
                          </>
                        )}
                      </button>
                    )}
                    {finalReviewComplete && (
                      <Link
                        href={`/reviewer/${id}/final-review`}
                        className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                      >
                        View Final Review
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Tips and Information */}
            <div className="bg-white rounded-lg shadow mt-6 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                <FaInfoCircle className="text-blue-600 mr-2" />
                How to Get the Best Results
              </h3>
              
              <div className="text-gray-600">
                <ul className="space-y-2 pl-6 list-disc">
                  <li>
                    Fastest start: "Import Full Proposal" splits one document into the sections this
                    call requires, and you can correct any block it places wrongly before it saves.
                  </li>
                  <li>Generate context summaries for more accurate and connected reviews.</li>
                  <li>The advanced review process will check for consistency across sections.</li>
                  <li>The final review provides scores and actionable recommendations.</li>
                  <li>
                    Use "View Call Rules" for the full guidelines — limits, criteria, per-section
                    requirements — and each section page lists the exact rules it is scored against.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* Final Review Summary (if available) - Mobile Friendly */}
      {finalReviewComplete && call?.overall_review_json && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 sm:px-6 py-4 bg-blue-50 border-b border-blue-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-blue-900 mb-2 sm:mb-0">Final Review Summary</h2>
                <Link
                  href={`/reviewer/${id}/final-review`}
                  className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                >
                  <FaFileAlt className="mr-2" /> View Full Report
                </Link>
              </div>
            </div>
            
            <div className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg text-center sm:text-left">
                  <span className="text-sm text-blue-700 font-medium block sm:inline">Overall Score</span>
                  <span className="font-bold text-3xl text-blue-700 block mt-1 sm:mt-0 sm:ml-2">
                    {call.overall_review_json.overall_score?.toFixed(1) || "N/A"}<span className="text-xl">/10</span>
                  </span>
                </div>
                
                <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-md text-sm flex items-center">
                    <FaCheck className="mr-2" /> {call.overall_review_json.major_strengths?.length || 0} Strengths
                  </div>
                  <div className="bg-red-100 text-red-800 px-4 py-2 rounded-md text-sm flex items-center">
                    <FaTimes className="mr-2" /> {call.overall_review_json.major_weaknesses?.length || 0} Weaknesses
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-medium text-gray-800 mb-2">Executive Summary</h3>
                <p className="text-gray-700 whitespace-pre-line line-clamp-3 sm:line-clamp-2">
                  {call.overall_review_json.executive_summary || "No executive summary provided"}
                </p>
                <div className="mt-3 text-center sm:text-right">
                  <Link
                    href={`/reviewer/${id}/final-review`}
                    className="text-blue-600 hover:text-blue-800 text-sm inline-flex items-center"
                  >
                    Read complete review <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
