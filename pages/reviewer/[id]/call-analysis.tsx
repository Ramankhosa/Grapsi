// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaCheck, FaTimes } from "react-icons/fa";

// Function to check if content is HTML
const isHtmlContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(content);
};

// Utility function to safely render any type of content
const renderSafely = (content: any, defaultValue: string = ""): React.ReactNode => {
  if (content === null || content === undefined) {
    return defaultValue;
  }
  
  if (typeof content === 'string') {
    // Check if content is HTML, render it using dangerouslySetInnerHTML
    if (isHtmlContent(content)) {
      return <div dangerouslySetInnerHTML={{ __html: content }} />;
    }
    return content;
  }
  
  if (typeof content === 'object') {
    // Handle arrays
    if (Array.isArray(content)) {
      return content.map((item, i) => <span key={i}>{renderSafely(item)}</span>);
    }
    
    // Handle objects with point and detail keys
    if (content.point !== undefined) {
      return <><strong>{content.point}</strong>: {content.detail || ''}</>;
    } else if (content.detail !== undefined) {
      return content.detail.toString();
    } else {
      // Fallback to stringify for other objects
      try {
        return JSON.stringify(content);
      } catch (e) {
        return defaultValue;
      }
    }
  }
  
  // For other primitive types like numbers
  return String(content);
};

export default function CallAnalysisPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id } = router.query;
  
  const [call, setCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Fetch call details
  const fetchCallDetails = async () => {
    if (!id || status !== "authenticated") return;
    
    try {
      setLoading(true);
      
      // Fetch the call info
      const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
      setCall(callResponse.data.call);
      
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
  
  // Access parsed JSON directly from the call object
  const parsedData = call?.parsed_json || {};
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);
  
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
            href={`/reviewer/${id}`}
            className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Project
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
            className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
        <title>Template Rules - {call.project_title}</title>
        <meta
          name="description"
          content={`Funding call analysis for ${call.project_title}`}
        />
      </Head>
      
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-800 to-blue-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{call.project_title}</h1>
              <p className="mt-1 text-blue-100">
              Template Rules
              </p>
            </div>
            <Link 
              href={`/reviewer/${id}`}
              className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
            >
              <FaArrowLeft className="mr-2" />
              Back to Project
            </Link>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
            <h2 className="text-xl font-semibold text-blue-900">Template & Manual Reviewer Rules</h2>
          </div>
          
          <div className="p-6">
            <h3 className="text-xl font-semibold">{parsedData.title || call.project_title}</h3>
            
            {/* Key details table */}
            <div className="mt-4 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50">Agency</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{parsedData.agency_name || call.agency_name}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50">Budget Cap</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{parsedData.budget_cap || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50">Duration</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{parsedData.project_duration_limit || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50">Deadline</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{parsedData.submission_deadline || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50">Rule source</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {parsedData.rules_source === "template_manual" ? "Approved template plus manual rubric" : call.LLM_model_used}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Sections */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Eligibility & Focus Areas</h3>
              
              <div className="bg-gray-50 rounded-md p-4 mb-4">
                <h4 className="text-sm font-medium text-gray-700">Eligibility Criteria</h4>
                <p className="mt-2 text-gray-800 whitespace-pre-line">{parsedData.eligibility_criteria || "Not specified"}</p>
              </div>
              
              {parsedData.thrust_areas && parsedData.thrust_areas.length > 0 && (
                <div className="bg-gray-50 rounded-md p-4 mb-4">
                  <h4 className="text-sm font-medium text-gray-700">Focus Areas</h4>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    {Array.isArray(parsedData.thrust_areas) 
                      ? parsedData.thrust_areas.map((area, idx) => (
                          <li key={idx} className="text-gray-800">{renderSafely(area)}</li>
                        ))
                      : <li className="text-gray-800">{renderSafely(parsedData.thrust_areas)}</li>
                    }
                  </ul>
                </div>
              )}
            </div>
            
            {/* Evaluation Criteria */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Evaluation Criteria</h3>
              <div className="bg-gray-50 rounded-md p-4">
                {Array.isArray(parsedData.evaluation_criteria) && parsedData.evaluation_criteria.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.evaluation_criteria.map((item, idx) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : typeof parsedData.evaluation_criteria === 'string' && parsedData.evaluation_criteria.trim() ? (
                  <p className="text-gray-800 whitespace-pre-line">{parsedData.evaluation_criteria}</p>
                ) : (
                  <p className="text-gray-600 italic">Not specified</p>
                )}
              </div>
            </div>
            
            {/* Dos and Don'ts */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center">
                  <FaCheck className="text-green-500 mr-2" />
                  Must Address
                </h3>
                <div className="bg-green-50 rounded-md p-4">
                  {Array.isArray(parsedData.dos) && parsedData.dos.length > 0 ? (
                    <ul className="space-y-1 list-disc list-inside">
                      {parsedData.dos.map((item, idx) => (
                        <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-600 italic">No specific requirements listed</p>
                  )}
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center">
                  <FaTimes className="text-red-500 mr-2" />
                  Avoid
                </h3>
                <div className="bg-red-50 rounded-md p-4">
                  {Array.isArray(parsedData.donts) && parsedData.donts.length > 0 ? (
                    <ul className="space-y-1 list-disc list-inside">
                      {parsedData.donts.map((item, idx) => (
                        <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-600 italic">No specific restrictions listed</p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Mandatory Sections */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Required Proposal Sections</h3>
              <div className="bg-gray-50 rounded-md p-4">
                {Array.isArray(parsedData.mandatory_sections) && parsedData.mandatory_sections.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.mandatory_sections.map((item, idx) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-600 italic">No specific sections listed</p>
                )}
              </div>
            </div>

            {Array.isArray(parsedData.format_rules) && parsedData.format_rules.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4">Format Rules</h3>
                <div className="bg-gray-50 rounded-md p-4">
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.format_rules.map((item, idx) => (
                      <li key={idx} className="text-gray-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {Array.isArray(parsedData.template_sections) && parsedData.template_sections.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4">Template Reviewer Buckets</h3>
                <div className="space-y-3">
                  {parsedData.template_sections.map((section, idx) => (
                    <div key={`${section.key || idx}`} className="rounded-md bg-gray-50 p-4">
                      <div className="font-medium text-gray-900">{section.label}</div>
                      <div className="mt-1 text-sm text-gray-600">{section.bucketLabel || section.bucketKey}</div>
                      {section.reviewerGoal ? (
                        <p className="mt-2 text-sm text-gray-800">{section.reviewerGoal}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
} 
