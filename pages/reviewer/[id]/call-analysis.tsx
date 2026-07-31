// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaCheck, FaTimes } from "react-icons/fa";
import { RULES_SOURCE_LABELS } from "@/lib/reviewer/rulesSource";
import { ReviewerProse, ReviewerText } from "@/components/reviewer/ReviewerText";
import ReviewerShell from "@/components/reviewer/ReviewerShell";

// These rules are extracted from third-party funding-call pages, so they are
// rendered as text/markdown and never as markup.
const renderSafely = (content: any, defaultValue: string = ""): React.ReactNode => (
  <ReviewerText value={content} fallback={defaultValue} />
);

export default function CallAnalysisPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id } = router.query;
  
  const [call, setCall] = useState(null);
  const [sections, setSections] = useState([]);
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

      try {
        const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
        setSections(sectionsResponse.data.sections || []);
      } catch (sectionsError) {
        console.error("Error fetching sections:", sectionsError);
      }

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
      <div className="min-h-screen bg-nickel-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg ">
          <h2 className="text-xl font-semibold text-red-600">Error</h2>
          <p className="mt-2">{error}</p>
          <Link 
            href={`/reviewer/${id}`}
            className="mt-4 inline-block px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
          >
            Back to Project
          </Link>
        </div>
      </div>
    );
  }
  
  if (!call) {
    return (
      <div className="min-h-screen bg-nickel-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg ">
          <h2 className="text-xl font-semibold">Project Not Found</h2>
          <p className="mt-2">The requested project could not be found.</p>
          <Link 
            href="/reviewer" 
            className="mt-4 inline-block px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <ReviewerShell call={call} sections={sections} title="Call rules">
      <div className="nk-panel overflow-hidden">
        <div className="nk-panel-head">
          <h2 className="nk-title">What this call requires</h2>
        </div>

          <div className="p-6">
            <h3 className="text-xl font-semibold">{parsedData.title || call.project_title}</h3>
            
            {/* Key details table */}
            <div className="mt-4 overflow-hidden">
              <table className="min-w-full divide-y divide-nickel-200">
                <tbody className="divide-y divide-nickel-200">
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Agency</td>
                    <td className="px-4 py-3 text-sm text-nickel-900">{parsedData.agency_name || call.agency_name}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Budget Cap</td>
                    <td className="px-4 py-3 text-sm text-nickel-900">{parsedData.budget_cap || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Duration</td>
                    <td className="px-4 py-3 text-sm text-nickel-900">{parsedData.project_duration_limit || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Deadline</td>
                    <td className="px-4 py-3 text-sm text-nickel-900">{parsedData.submission_deadline || "Not specified"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Rule source</td>
                    <td className="px-4 py-3 text-sm text-nickel-900">
                      {RULES_SOURCE_LABELS[parsedData.rules_source] || call.LLM_model_used}
                      {parsedData.extraction?.model ? (
                        <span className="ml-2 text-xs text-nickel-500">via {parsedData.extraction.model}</span>
                      ) : null}
                    </td>
                  </tr>
                  {Array.isArray(parsedData.source_urls) && parsedData.source_urls.length > 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-sm font-medium text-nickel-700 bg-nickel-50">Source</td>
                      <td className="px-4 py-3 text-sm text-nickel-900">
                        <ul className="space-y-1">
                          {parsedData.source_urls.map((url, idx) => (
                            <li key={idx}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="break-all text-cobalt-700 hover:underline"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            
            {/* Sections */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Eligibility & Focus Areas</h3>
              
              <div className="bg-nickel-50 rounded-md p-4 mb-4">
                <h4 className="text-sm font-medium text-nickel-700">Eligibility Criteria</h4>
                <ReviewerProse
                  value={parsedData.eligibility_criteria}
                  fallback="Not specified"
                  className="mt-2 text-nickel-800"
                />
              </div>
              
              {parsedData.thrust_areas && parsedData.thrust_areas.length > 0 && (
                <div className="bg-nickel-50 rounded-md p-4 mb-4">
                  <h4 className="text-sm font-medium text-nickel-700">Focus Areas</h4>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    {Array.isArray(parsedData.thrust_areas) 
                      ? parsedData.thrust_areas.map((area, idx) => (
                          <li key={idx} className="text-nickel-800">{renderSafely(area)}</li>
                        ))
                      : <li className="text-nickel-800">{renderSafely(parsedData.thrust_areas)}</li>
                    }
                  </ul>
                </div>
              )}
            </div>
            
            {/* Weighted scoring criteria, when the call publishes them */}
            {Array.isArray(parsedData.scoring_criteria) && parsedData.scoring_criteria.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4">Scoring Criteria</h3>
                <div className="overflow-x-auto rounded-md border border-nickel-200">
                  <table className="min-w-full divide-y divide-nickel-200 text-sm">
                    <thead className="bg-nickel-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Criterion</th>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Weight</th>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">What it covers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-nickel-200">
                      {parsedData.scoring_criteria.map((criterion, idx) => (
                        <tr key={criterion.key || idx}>
                          <td className="px-4 py-2 text-nickel-900">{criterion.label}</td>
                          <td className="px-4 py-2 text-nickel-600">
                            {criterion.weight !== null && criterion.weight !== undefined ? criterion.weight : "—"}
                          </td>
                          <td className="px-4 py-2 text-nickel-700">{criterion.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Evaluation Criteria */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Evaluation Criteria</h3>
              <div className="bg-nickel-50 rounded-md p-4">
                {Array.isArray(parsedData.evaluation_criteria) && parsedData.evaluation_criteria.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.evaluation_criteria.map((item, idx) => (
                      <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : typeof parsedData.evaluation_criteria === 'string' && parsedData.evaluation_criteria.trim() ? (
                  <ReviewerProse value={parsedData.evaluation_criteria} className="text-nickel-800" />
                ) : (
                  <p className="text-nickel-600 italic">Not specified</p>
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
                        <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-nickel-600 italic">No specific requirements listed</p>
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
                        <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-nickel-600 italic">No specific restrictions listed</p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Mandatory Sections */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Required Proposal Sections</h3>
              <div className="bg-nickel-50 rounded-md p-4">
                {Array.isArray(parsedData.mandatory_sections) && parsedData.mandatory_sections.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.mandatory_sections.map((item, idx) => (
                      <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-nickel-600 italic">No specific sections listed</p>
                )}
              </div>
            </div>

            {Array.isArray(parsedData.format_rules) && parsedData.format_rules.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4">Format Rules</h3>
                <div className="bg-nickel-50 rounded-md p-4">
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.format_rules.map((item, idx) => (
                      <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {Array.isArray(parsedData.submission_rules) && parsedData.submission_rules.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-1">Submission Requirements</h3>
                <p className="mb-3 text-sm text-nickel-500">
                  Reminders only — these never affect your section scores.
                </p>
                <div className="bg-cobalt-50 rounded-md p-4">
                  <ul className="space-y-1 list-disc list-inside">
                    {parsedData.submission_rules.map((item, idx) => (
                      <li key={idx} className="text-nickel-800">{renderSafely(item)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {Array.isArray(parsedData.template_sections) && parsedData.template_sections.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-1">Per-Section Rules</h3>
                <p className="mb-4 text-sm text-nickel-500">
                  What a reviewer looks for in each section, and the limits that apply. Sections marked
                  as submission material are reported as reminders and never scored.
                </p>
                <div className="space-y-3">
                  {parsedData.template_sections.map((section, idx) => {
                    const isSubmission = section.bucketKey === 'attachments_submission'
                      || (section.workflowMode && section.workflowMode !== 'app_draft');

                    return (
                      <div
                        key={`${section.key || idx}`}
                        className={`rounded-md border p-4 ${
                          isSubmission ? 'border-nickel-200 bg-nickel-50' : 'border-green-100 bg-green-50/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-nickel-900">{section.label}</div>
                            <div className="mt-0.5 text-xs text-nickel-600">
                              {section.bucketLabel || section.bucketKey}
                              {section.required === false ? ' · optional' : ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {isSubmission ? (
                              <span className="rounded-full bg-nickel-200 px-2 py-0.5 text-xs text-nickel-700">
                                Not scored
                              </span>
                            ) : (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                                Scored
                              </span>
                            )}
                            {section.wordLimit ? (
                              <span className="rounded-full bg-cobalt-100 px-2 py-0.5 text-xs text-cobalt-800">
                                {section.wordLimit} words
                              </span>
                            ) : null}
                            {section.charLimit ? (
                              <span className="rounded-full bg-cobalt-100 px-2 py-0.5 text-xs text-cobalt-800">
                                {section.charLimit} characters
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {section.reviewerGoal ? (
                          <p className="mt-2 text-sm text-nickel-800">
                            {renderSafely(section.reviewerGoal)}
                          </p>
                        ) : null}

                        {Array.isArray(section.guidanceText) && section.guidanceText.length > 0 ? (
                          <div className="mt-3">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-nickel-500">
                              Guidance
                            </h5>
                            <ul className="mt-1 space-y-1 list-disc list-inside text-sm text-nickel-800">
                              {section.guidanceText.map((item, itemIdx) => (
                                <li key={itemIdx}>{renderSafely(item)}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {Array.isArray(section.requiredFacts) && section.requiredFacts.length > 0 ? (
                          <div className="mt-3">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-green-700">
                              Must state
                            </h5>
                            <ul className="mt-1 space-y-1 list-disc list-inside text-sm text-nickel-800">
                              {section.requiredFacts.map((item, itemIdx) => (
                                <li key={itemIdx}>{renderSafely(item)}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {Array.isArray(section.forbiddenMoves) && section.forbiddenMoves.length > 0 ? (
                          <div className="mt-3">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-red-700">
                              Avoid
                            </h5>
                            <ul className="mt-1 space-y-1 list-disc list-inside text-sm text-nickel-800">
                              {section.forbiddenMoves.map((item, itemIdx) => (
                                <li key={itemIdx}>{renderSafely(item)}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
        </div>
      </div>
    </ReviewerShell>
  );
} 
