// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaSpinner, FaEdit, FaClock, FaListAlt, FaExchangeAlt, FaChevronUp, FaChevronDown, FaCheck, FaTimes, FaSave, FaTrash, FaBan } from "react-icons/fa";
import RichTextEditor from "../../../../components/RichTextEditor";
import BudgetJustificationEditor from "../../../../components/BudgetJustificationEditor";
import ContextSummaryView from "../../../../components/ContextSummaryView";
import ReviewerSectionAssetsPanel from "../../../../components/ReviewerSectionAssetsPanel";
import { ReviewerProse, ReviewerText } from "@/components/reviewer/ReviewerText";
import ReviewerRulesPanel from "@/components/reviewer/ReviewerRulesPanel";

type SectionData = {
  id: string;
  call_id: string;
  section_title: string;
  user_input: string;
  ai_review_json: any;
  context_summary?: string;
  last_reviewed_at: string;
  status: string;
  version: number;
  previous_section_id: string | null;
  is_revision: boolean;
  improvement_flag: boolean | null;
};

type PriorSectionSummary = {
  section_title: string;
  context_summary: string;
};

// Reviewer output is text, not markup: render the model's markdown and strip
// any HTML rather than trusting it.
const renderSafely = (content: any, defaultValue: string = ""): React.ReactNode => (
  <ReviewerText value={content} fallback={defaultValue} />
);

const ADDRESSED_STYLES: Record<string, string> = {
  addressed: 'bg-green-100 text-green-800',
  partially: 'bg-amber-100 text-amber-800',
  not_addressed: 'bg-red-100 text-red-800',
};

const ADDRESSED_LABELS: Record<string, string> = {
  addressed: 'Addressed',
  partially: 'Partly addressed',
  not_addressed: 'Not addressed',
};

export default function SectionDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id: callId, sectionId } = router.query;
  
  const [section, setSection] = useState<SectionData | null>(null);
  const [promptScope, setPromptScope] = useState<any>(null);
  const [previousSection, setPreviousSection] = useState<SectionData | null>(null);
  const [priorSectionSummaries, setPriorSectionSummaries] = useState<PriorSectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSummaries, setShowSummaries] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  
  // New states for editing functionality
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [router, status]);
  
  // Fetch section details
  useEffect(() => {
    const fetchSectionDetails = async () => {
      if (!callId || !sectionId || status !== "authenticated") return;
      
      try {
        setLoading(true);
        const response = await axios.get(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
        
        // Log the section data for debugging
        console.log("Loaded section data:", response.data.section);
        
        // Ensure user_input is always at least an empty string to prevent undefined issues
        const sectionData = {
          ...response.data.section,
          user_input: response.data.section.user_input || ""
        };
        
        setSection(sectionData);
        setPromptScope(response.data.prompt_scope || null);

        // Initialize edited content with the current content
        setEditedContent(sectionData.user_input);
        
        // If this is a revision, fetch the previous version
        if (response.data.section.previous_section_id) {
          try {
            const prevResponse = await axios.get(
              `/api/reviewer/calls/${callId}/sections/${response.data.section.previous_section_id}`
            );
            setPreviousSection(prevResponse.data.section);
          } catch (err) {
            console.error("Error fetching previous section:", err);
          }
        }
        
        // Fetch prior section summaries based on current section
        try {
          const summariesResponse = await axios.get(
            `/api/reviewer/calls/${callId}/sections/${sectionId}/prior-summaries`
          );
          
          if (summariesResponse.data.summaries) {
            setPriorSectionSummaries(summariesResponse.data.summaries);
          }
        } catch (err) {
          console.error("Error fetching prior section summaries:", err);
        }
      } catch (err) {
        console.error("Error fetching section details:", err);
        setError("Failed to load section details");
        
        // If unauthorized or not found, redirect
        if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 404)) {
          router.push(`/reviewer/${callId}`);
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchSectionDetails();
  }, [callId, sectionId, status, router]);
  
  // Function to start a review if the section is in draft state
  const handleStartReview = async () => {
    if (!section || section.status !== "draft") return;
    
    try {
      setReviewLoading(true);
      setError("");
      
      await axios.post(`/api/reviewer/calls/${callId}/sections/${sectionId}/review`);
      
      // Refresh the section data
      const response = await axios.get(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
      setSection(response.data.section);
    } catch (err) {
      console.error("Error starting review:", err);
      setError("Failed to start review. Please try again.");
    } finally {
      setReviewLoading(false);
    }
  };
  
  // Function to create a revision of this section
  const handleRevise = () => {
    router.push(`/reviewer/${callId}/section/new?revision=true&sectionId=${sectionId}`);
  };
  
  // Direct revision from this page
  const handleDirectRevision = () => {
    // Create a shallow copy of the current section content so the user can edit it
    router.push({
      pathname: `/reviewer/${callId}/section/new`,
      query: { 
        revision: 'true', 
        sectionId: sectionId,
        directRevision: 'true'
      }
    });
  };
  
  // Toggle context summaries visibility
  const toggleSummariesView = () => {
    setShowSummaries(!showSummaries);
  };
  
  // Function to load comparison data between versions
  const loadComparisonData = async () => {
    if (!section?.previous_section_id || !previousSection) return;
    
    try {
      setComparisonLoading(true);
      const response = await axios.post(`/api/reviewer/calls/${callId}/sections/${sectionId}/compare-revisions`, {
        modelType: 'G' // Use Gemini for comparison
      });
      
      setComparisonData(response.data.comparison);
      setShowComparison(true);
    } catch (err) {
      console.error("Error fetching comparison data:", err);
      setError("Failed to load version comparison");
    } finally {
      setComparisonLoading(false);
    }
  };
  
  // Toggle comparison view
  const toggleComparisonView = async () => {
    if (!showComparison && !comparisonData) {
      await loadComparisonData();
    } else {
      setShowComparison(!showComparison);
    }
  };
  
  // Toggle edit mode
  const handleEdit = () => {
    if (!section || section.status !== 'draft') return;
    setIsEditing(true);
  };
  
  // Handle content change in the editor
  const handleContentChange = (value: string) => {
    setEditedContent(value);
  };
  
  // Cancel editing
  const handleCancelEdit = () => {
    if (!section) return;
    setEditedContent(section.user_input);
    setIsEditing(false);
  };
  
  // Save edited section
  const handleSave = async () => {
    if (!section || !callId || !sectionId) return;
    
    try {
      setSaveLoading(true);
      setError("");
      
      const response = await axios.put(`/api/reviewer/calls/${callId}/sections/${sectionId}`, {
        user_input: editedContent,
        section_title: section.section_title
      });
      
      // Update section data with saved changes
      setSection(response.data.section);
      setIsEditing(false);
    } catch (err) {
      console.error("Error saving section:", err);
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaveLoading(false);
    }
  };
  
  // Delete section
  const handleDelete = async () => {
    if (!section || !callId || !sectionId) return;
    
    try {
      setDeleteLoading(true);
      setError("");
      
      await axios.delete(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
      
      // Redirect back to call overview
      router.push(`/reviewer/${callId}`);
    } catch (err) {
      console.error("Error deleting section:", err);
      setError("Failed to delete section. Please try again.");
      setDeleteLoading(false);
      setDeleteConfirm(false);
    }
  };
  
  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (!section) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <p className="text-red-600 mb-4">Section not found</p>
        <Link 
          href={`/reviewer/${callId}`}
          className="text-blue-600 hover:underline"
        >
          Return to project
        </Link>
      </div>
    );
  }
  
  const reviewJson = section.ai_review_json || {};
  const hasReview = section.status === "reviewed" && Object.keys(reviewJson).length > 0;
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>{section.section_title} - AI Grant Reviewer</title>
        <meta
          name="description"
          content="View proposal section and AI review"
        />
      </Head>
      
      {/* Header */}
      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center">
                <h1 className="text-3xl font-bold text-white">{section.section_title}</h1>
                {section.version > 1 && (
                  <span className="ml-2 bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded-full">
                    Version {section.version}
                  </span>
                )}
              </div>
              <p className="mt-1 text-green-100">
                Status: {section.status.charAt(0).toUpperCase() + section.status.slice(1)}
                {section.is_revision && " (Revision)"}
              </p>
            </div>
            <Link 
              href={`/reviewer/${callId}`}
              className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
            >
              <FaArrowLeft className="mr-2" />
              Back to Project
            </Link>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-6">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
            {error}
          </div>
        )}
        
        {/* Delete confirmation dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Confirm Deletion</h3>
              <p className="text-gray-700 mb-6">Are you sure you want to delete this section? This action cannot be undone.</p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors"
                  disabled={deleteLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center"
                  disabled={deleteLoading}
                >
                  {deleteLoading ? (
                    <><FaSpinner className="animate-spin mr-2" /> Deleting...</>
                  ) : (
                    <><FaTrash className="mr-2" /> Delete</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Version comparison panel — shown whenever an earlier version exists,
            including sections that were re-submitted without being labelled a
            revision. */}
        {previousSection && (
          <div className="mb-6">
            <div className="flex items-center justify-between bg-amber-50 p-4 rounded-t-lg border-b border-amber-100">
              <div className="flex items-center">
                <h2 className="text-lg font-medium text-amber-800">Version Comparison</h2>
                {section.improvement_flag !== null && (
                  <span className={`ml-3 px-2 py-1 rounded-full text-xs font-medium ${
                    section.improvement_flag 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {section.improvement_flag 
                      ? <><FaCheck className="inline mr-1" size={10} /> Improved</> 
                      : <><FaTimes className="inline mr-1" size={10} /> No significant improvement</>}
                  </span>
                )}
              </div>
              <button
                onClick={toggleComparisonView}
                className="flex items-center text-amber-600 hover:text-amber-800"
                disabled={comparisonLoading}
              >
                {comparisonLoading ? (
                  <><FaSpinner className="mr-2 animate-spin" /> Loading...</>
                ) : (
                  <><FaExchangeAlt className="mr-2" /> {showComparison ? "Hide Comparison" : "Show Comparison"}</>
                )}
              </button>
            </div>
            
            {showComparison && comparisonData && (
              <div className="bg-white p-4 rounded-b-lg shadow">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-medium text-gray-700 mb-2">Previous Version (v{previousSection.version})</h3>
                    <div className="text-sm text-gray-600 max-h-60 overflow-y-auto border border-gray-200 rounded p-3 bg-white">
                      <RichTextEditor
                        value={previousSection.user_input || ""}
                        onChange={() => {}}
                        readOnly={true}
                      />
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-medium text-gray-700 mb-2">Current Version (v{section.version})</h3>
                    <div className="text-sm text-gray-600 max-h-60 overflow-y-auto border border-gray-200 rounded p-3 bg-white">
                      <RichTextEditor
                        value={section.user_input || ""}
                        onChange={() => {}}
                        readOnly={true}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <h3 className="font-medium text-gray-700 mb-3">Analysis of Changes</h3>
                  
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-600 mb-1">Improvement Summary</h4>
                    <ReviewerProse
                      value={comparisonData.improvement_summary}
                      className="text-sm text-gray-800 bg-gray-50 p-3 rounded"
                    />
                  </div>

                  {/* What happened to each point the previous review raised */}
                  {Array.isArray(comparisonData.addressed_points) && comparisonData.addressed_points.length > 0 && (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-medium text-gray-600">Previous Review Points</h4>
                        <div className="flex items-center gap-2 text-xs">
                          {comparisonData.addressed_summary && (
                            <span className="text-gray-600">
                              {comparisonData.addressed_summary.addressed} of {comparisonData.addressed_summary.total} resolved
                            </span>
                          )}
                          {typeof comparisonData.score_delta === 'number' && (
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${
                                comparisonData.score_delta > 0
                                  ? 'bg-green-100 text-green-800'
                                  : comparisonData.score_delta < 0
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {comparisonData.score_delta > 0 ? '+' : ''}
                              {comparisonData.score_delta.toFixed(1)} vs v{previousSection.version}
                            </span>
                          )}
                        </div>
                      </div>
                      <ul className="space-y-2">
                        {comparisonData.addressed_points.map((point: any, index: number) => (
                          <li key={index} className="rounded border border-gray-200 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm text-gray-900">{renderSafely(point.point)}</span>
                              <span
                                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                  ADDRESSED_STYLES[point.status] || 'bg-gray-100 text-gray-700'
                                }`}
                              >
                                {ADDRESSED_LABELS[point.status] || point.status}
                              </span>
                            </div>
                            {point.evidence && (
                              <p className="mt-1 text-xs text-gray-600">{renderSafely(point.evidence)}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-600 mb-1">Key Changes</h4>
                      <ul className="list-disc list-inside text-sm text-gray-800 bg-gray-50 p-3 rounded">
                        {comparisonData.key_changes.map((change: any, index: number) => (
                          <li key={index} className="mb-1">{renderSafely(change)}</li>
                        ))}
                      </ul>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-600 mb-1">Improvements</h4>
                      <ul className="list-disc list-inside text-sm text-gray-800 bg-gray-50 p-3 rounded">
                        {comparisonData.improvements.map((improvement: any, index: number) => (
                          <li key={index} className="mb-1">{renderSafely(improvement)}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  
                  {comparisonData.remaining_issues && comparisonData.remaining_issues.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-600 mb-1">Remaining Issues</h4>
                      <ul className="list-disc list-inside text-sm text-gray-800 bg-gray-50 p-3 rounded">
                        {comparisonData.remaining_issues.map((issue: any, index: number) => (
                          <li key={index} className="mb-1">{renderSafely(issue)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {comparisonData.further_recommendations && comparisonData.further_recommendations.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-600 mb-1">Further Recommendations</h4>
                      <ul className="list-disc list-inside text-sm text-gray-800 bg-gray-50 p-3 rounded">
                        {comparisonData.further_recommendations.map((rec: any, index: number) => (
                          <li key={index} className="mb-1">{renderSafely(rec)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* The rules this section is actually scored against */}
        <ReviewerRulesPanel
          scope={promptScope}
          sectionTitle={section.section_title}
          callRulesHref={`/reviewer/${callId}/call-analysis`}
          defaultOpen={section.status === 'draft'}
        />

        {/* Context Summaries Panel (conditionally displayed) */}
        {priorSectionSummaries.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between bg-blue-50 p-4 rounded-t-lg border-b border-blue-100">
              <h2 className="text-lg font-medium text-blue-800">Previous Sections Context</h2>
              <button
                onClick={toggleSummariesView}
                className="flex items-center text-blue-600 hover:text-blue-800"
              >
                <FaListAlt className="mr-2" />
                {showSummaries ? "Hide Summaries" : "Show Summaries"}
              </button>
            </div>
            
            {showSummaries && (
              <div className="bg-white p-4 rounded-b-lg shadow">
                <ContextSummaryView summaries={priorSectionSummaries} />
              </div>
            )}
          </div>
        )}
        
        {/* Section content and review */}
        <div className={`grid ${hasReview ? 'grid-cols-1 xl:grid-cols-3 gap-5' : 'grid-cols-1'}`}>
          {/* Section content */}
          <div className="bg-white rounded-lg shadow p-5 xl:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-800">Section Content</h2>
              {section.status === 'draft' && !isEditing && (
                <div className="flex space-x-2">
                  <button
                    onClick={handleEdit}
                    className="px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors flex items-center"
                  >
                    <FaEdit className="mr-1" /> Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="px-3 py-1 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors flex items-center"
                  >
                    <FaTrash className="mr-1" /> Delete
                  </button>
                </div>
              )}
            </div>
            
            <div className="mb-6">
              {/* Add debug info */}
              {(process.env.NODE_ENV === 'development') && 
                <div className="mb-2 text-xs text-gray-500">
                  Content length: {(isEditing ? editedContent : (section?.user_input || ""))?.length || 0} characters
                </div>
              }
              
              {section.section_title.toLowerCase().includes('budget') ? (
                <BudgetJustificationEditor
                  value={isEditing ? editedContent : (section.user_input || "")}
                  onChange={handleContentChange}
                  readOnly={!isEditing}
                />
              ) : (
                <RichTextEditor
                  value={isEditing ? editedContent : (section.user_input || "")}
                  onChange={handleContentChange}
                  readOnly={!isEditing}
                />
              )}
            </div>

            {/* Assets panel for specific sections */}
            {['Methodology','Project Timeline','Budget Justification'].some(label => section.section_title.toLowerCase().includes(label.toLowerCase())) && (
              <div className="mb-6">
                <h3 className="text-lg font-medium text-gray-800 mb-2">Section Assets</h3>
                <ReviewerSectionAssetsPanel
                  reviewVersionId={section.id}
                  projectId={section.call_id /* using call_id as project scope placeholder */}
                  sectionType={
                    section.section_title.toLowerCase().includes('method') ? 'METHODOLOGY' :
                    section.section_title.toLowerCase().includes('timeline') ? 'TIMELINE' :
                    'BUDGET_JUSTIFICATION'
                  }
                />
              </div>
            )}
            
            <div className="flex justify-between items-center text-sm text-gray-500 mt-4">
              <div className="flex items-center">
                <FaClock className="mr-1" />
                Last updated: {new Date(section.last_reviewed_at).toLocaleString()}
              </div>
              
              {isEditing ? (
                <div className="flex space-x-2">
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors flex items-center"
                    disabled={saveLoading}
                  >
                    <FaBan className="mr-1" /> Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center"
                    disabled={saveLoading}
                  >
                    {saveLoading ? (
                      <><FaSpinner className="animate-spin mr-1" /> Saving...</>
                    ) : (
                      <><FaSave className="mr-1" /> Save</>
                    )}
                  </button>
                </div>
              ) : (
                <>
                  {section.status === "draft" && !isEditing && (
                    <button
                      onClick={handleStartReview}
                      disabled={reviewLoading}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {reviewLoading ? (
                        <span className="flex items-center">
                          <FaSpinner className="animate-spin mr-2" />
                          Reviewing...
                        </span>
                      ) : (
                        "Start Review"
                      )}
                    </button>
                  )}
                </>
              )}
              
              {section.status === "reviewed" && !isEditing && (
                <div className="flex flex-col space-y-2">
                  <button
                    onClick={handleRevise}
                    className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-md hover:bg-amber-200 transition-colors"
                  >
                    <FaEdit className="inline-block mr-1" />
                    Revise Section
                  </button>
                  
                  <div className="flex items-center mt-1 ml-1">
                    <input 
                      type="checkbox" 
                      id="direct-revision" 
                      className="mr-2 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                      onChange={handleDirectRevision}
                    />
                    <label htmlFor="direct-revision" className="text-sm text-gray-700 cursor-pointer">
                      Review Revised Content
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Review Panel */}
          {hasReview && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">AI Review</h2>
              
              {/* Score */}
              <div className="flex items-center mb-4">
                <span className="text-sm text-gray-600 mr-2">Score:</span>
                <div className="rounded-full bg-gray-100 p-1">
                  <span className={`text-white font-medium px-3 py-1 rounded-full inline-block ${
                    reviewJson.score >= 8 ? 'bg-green-500' :
                    reviewJson.score >= 6 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}>
                    {reviewJson.score?.toFixed(1) || "-"}/10
                  </span>
                </div>
                
                {/* Show improvement indicator for revisions */}
                {section.is_revision && (
                  <span className={`ml-3 text-sm ${section.improvement_flag ? 'text-green-600' : 'text-red-600'}`}>
                    {section.improvement_flag ? '↑ Improved' : '↓ Not improved'}
                  </span>
                )}
              </div>
              
              {/* Summary */}
              <div className="mb-6">
                <h3 className="font-medium text-gray-700 mb-2">Summary</h3>
                <p className="text-gray-800 bg-gray-50 p-3 rounded">{reviewJson.summary}</p>
              </div>
              
              {/* Strengths */}
              <div className="mb-6">
                <h3 className="font-medium text-gray-700 mb-2">Strengths</h3>
                {Array.isArray(reviewJson.strengths) && reviewJson.strengths.length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {reviewJson.strengths.map((item: any, idx: number) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-600 italic">No specific strengths highlighted</p>
                )}
              </div>
              
              {/* Weaknesses */}
              <div className="mb-6">
                <h3 className="font-medium text-gray-700 mb-2">Weaknesses</h3>
                {Array.isArray(reviewJson.weaknesses) && reviewJson.weaknesses.length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {reviewJson.weaknesses.map((item: any, idx: number) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-600 italic">No specific weaknesses highlighted</p>
                )}
              </div>
              
              {/* Recommendations */}
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Recommendations</h3>
                {(Array.isArray(reviewJson.recommendations) && reviewJson.recommendations.length > 0) || (Array.isArray(reviewJson.suggestions) && reviewJson.suggestions.length > 0) ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {(reviewJson.recommendations || reviewJson.suggestions || []).map((item: any, idx: number) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-600 italic">No specific recommendations provided</p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
