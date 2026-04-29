// @ts-nocheck
import { useState, FormEvent, useEffect, useRef } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaSpinner, FaSave, FaChevronDown, FaChevronRight, FaEye, FaCheck, FaClock, FaEdit } from "react-icons/fa";
import { toast } from "react-hot-toast";
import SectionSelector from "../../../../components/SectionSelector";
import RichTextEditor from "../../../../components/RichTextEditor";
import BudgetJustificationEditor from "../../../../components/BudgetJustificationEditor";

type SectionData = {
  id: string;
  section_title: string;
  status: string;
  version: number;
  ai_review_json?: any;
  call_id?: string;
  user_input?: string;
  last_reviewed_at?: string;
  previous_section_id?: string | null;
  is_revision?: boolean;
  improvement_flag?: boolean | null;
};

// Utility function to safely render any type of content
const renderSafely = (content: any, defaultValue: string = ""): React.ReactNode => {
  if (content === null || content === undefined) {
    return defaultValue;
  }
  
  if (typeof content === 'string') {
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

export default function NewSection() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id: callId } = router.query;
  
  const [formData, setFormData] = useState({
    section_title: "",
    user_input: "",
    is_revision: false,
    previous_section_id: ""
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usedSections, setUsedSections] = useState<string[]>([]);
  const [isRevision, setIsRevision] = useState(false);
  const [previousSections, setPreviousSections] = useState<{id: string, section_title: string, version: number}[]>([]);
  const [selectedPreviousSection, setSelectedPreviousSection] = useState<{id: string, section_title: string} | null>(null);
  const [existingSections, setExistingSections] = useState<SectionData[]>([]);
  const [expandedSections, setExpandedSections] = useState<{[key: string]: boolean}>({});
  const [reviewRevisionMode, setReviewRevisionMode] = useState(false);
  const [selectedSectionToRevise, setSelectedSectionToRevise] = useState<string | null>(null);
  
  // New state for selected section to view
  const [selectedSection, setSelectedSection] = useState<SectionData | null>(null);
  const [showFormArea, setShowFormArea] = useState(true);
  const [isFetchingSelectedSection, setIsFetchingSelectedSection] = useState(false);
  const [isCreatingNewSection, setIsCreatingNewSection] = useState(false);
  const [stagedAssets, setStagedAssets] = useState<{ asset_id: string; preview_url: string; mime?: string }[]>([]);
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }

    // Check if revision mode is requested via URL parameter
    if (router.query.revision === "true") {
      setIsRevision(true);
      setFormData(prev => ({ ...prev, is_revision: true }));
      
      // If sectionId is provided in query, set it as the section to revise
      if (router.query.sectionId) {
        setSelectedSectionToRevise(router.query.sectionId as string);
        
        // If this is a direct revision, set the revision mode
        if (router.query.directRevision === "true") {
          setReviewRevisionMode(true);
        }
      }
    }
  }, [router, status, router.query.revision, router.query.sectionId, router.query.directRevision]);
  
  // Fetch existing sections to show on the page and determine which ones are already used
  useEffect(() => {
    const fetchSections = async () => {
      if (callId && status === "authenticated") {
        try {
          // Check URL parameters for 'new' query parameter
          const isNewSection = router.query.new === "true";
          
          // If explicitly requesting a new section, set the flags right away
          if (isNewSection) {
            setShowFormArea(true);
            setIsCreatingNewSection(true);
            setSelectedSection(null);
            return; // Skip fetching sections to ensure blank form
          }
          
          const response = await axios.get(`/api/reviewer/calls/${callId}/sections`);
          const sections = response.data.sections || [];
          
          // Extract used section titles for the dropdown
          const titles = sections.map((section: any) => section.section_title);
          setUsedSections(Array.from(new Set(titles)));
          
          // Set all sections for display
          setExistingSections(sections);
          
          // Always show form area for new section page regardless of existing sections
          setShowFormArea(true);
          setIsCreatingNewSection(true);
          
          // Extract sections for revision selection
          const sectionsByTitle = sections.reduce((acc: any, section: any) => {
            if (!acc[section.section_title]) {
              acc[section.section_title] = [];
            }
            acc[section.section_title].push({
              id: section.id,
              section_title: section.section_title,
              version: section.version || 1
            });
            return acc;
          }, {});
          
          // Get latest version of each section for the revision dropdown
          const latestSections = Object.values(sectionsByTitle).map((sectionVersions: any) => {
            return sectionVersions.reduce((latest: any, current: any) => 
              (!latest || current.version > latest.version) ? current : latest, null);
          });
          
          setPreviousSections(latestSections);
          
          // If there's a section ID to revise from URL params, select it
          if (selectedSectionToRevise) {
            const sectionToRevise = sections.find((s: any) => s.id === selectedSectionToRevise);
            if (sectionToRevise) {
              // For direct revision, copy the existing content into the form
              const isDirectRevision = router.query.directRevision === "true";
              
              setFormData(prev => ({
                ...prev,
                section_title: sectionToRevise.section_title,
                previous_section_id: sectionToRevise.id,
                is_revision: true,
                user_input: isDirectRevision ? sectionToRevise.user_input : prev.user_input
              }));
              
              setSelectedPreviousSection({
                id: sectionToRevise.id,
                section_title: sectionToRevise.section_title
              });
            }
          }
          
          // Don't auto-select the first section - always default to new section form
        } catch (error) {
          console.error("Error fetching sections:", error);
        }
      }
    };
    
    fetchSections();
  }, [callId, status, selectedSectionToRevise, router.query.directRevision, selectedSection, isCreatingNewSection, router.query.new]);
  
  // Function to handle viewing a section
  const handleViewSection = async (sectionId: string) => {
    if (!callId || !sectionId) return;
    
    try {
      setIsFetchingSelectedSection(true);
      setIsCreatingNewSection(false); // Reset the creation mode flag
      const response = await axios.get(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
      setSelectedSection(response.data.section);
      setShowFormArea(false);
    } catch (err) {
      console.error("Error fetching section details:", err);
    } finally {
      setIsFetchingSelectedSection(false);
    }
  };
  
  const handleSectionSelect = (section: string) => {
    setFormData(prev => ({ ...prev, section_title: section }));
  };
  
  const handleTextChange = (content: string) => {
    setFormData(prev => ({ ...prev, user_input: content }));
  };

  // Determine if current section supports assets
  const selectedSectionSupportsAssets = () => {
    const title = (formData.section_title || "").toLowerCase();
    return title.includes("method") || title.includes("timeline") || title.includes("budget justification") || title.includes("budget");
  };

  const currentSectionType = () => {
    const title = (formData.section_title || "").toLowerCase();
    if (title.includes("method")) return "METHODOLOGY" as const;
    if (title.includes("timeline")) return "TIMELINE" as const;
    return "BUDGET_JUSTIFICATION" as const;
  };

  const handleSelectFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !callId) return;
    const file = files[0];
    
    console.log("Client selected file:", file.name, file.type, file.size);
    
    // Add file extension check on client side too
    const fileName = file.name.toLowerCase();
    const fileExt = fileName.substring(fileName.lastIndexOf('.'));
    const validExts = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];
    if (!validExts.includes(fileExt)) {
      toast.error(`Invalid file type. Please use PNG, JPG, WEBP, or PDF`);
      setAssetError(`Invalid file type: ${fileExt}. Please use PNG, JPG, WEBP, or PDF`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    
    const form = new FormData();
    form.append("file", file);
    form.append("project_id", String(callId));
    
    // Debug form content
    console.log("FormData created with:", {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      projectId: callId
    });
    
    try {
      setAssetUploading(true);
      setAssetError(null);
      
      // IMPORTANT: Don't set Content-Type header for multipart forms
      // And add timeout to ensure the request completes
      const res = await axios.post(`/api/reviewer/assets/upload`, form, {
        timeout: 30000
      });
      
      console.log("Upload success response:", res.data);
      const { asset_id, preview_url } = res.data || {};
      if (asset_id) {
        setStagedAssets(prev => [...prev, { asset_id, preview_url, mime: file.type }]);
        toast.success("Asset uploaded");
      } else {
        throw new Error("No asset_id in response");
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMsg = e?.response?.data?.error || e?.message || "Unknown error";
      console.error("Upload failed", e);
      console.error("Error details:", status, serverMsg, e?.response?.data);
      toast.error(`Upload failed${status ? ` (${status})` : ''}`);
      setAssetError(`Upload failed${status ? ` (${status})` : ''}: ${serverMsg}`);
    } finally {
      setAssetUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeStagedAsset = (asset_id: string) => {
    setStagedAssets(prev => prev.filter(a => a.asset_id !== asset_id));
  };
  
  const toggleRevision = () => {
    setIsRevision(!isRevision);
    if (!isRevision) {
      setFormData(prev => ({ ...prev, section_title: "", previous_section_id: "", is_revision: true }));
    } else {
      setFormData(prev => ({ ...prev, previous_section_id: "", is_revision: false }));
    }
  };
  
  const toggleSectionExpand = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };
  
  const handlePreviousSectionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sectionId = e.target.value;
    const section = previousSections.find(s => s.id === sectionId);
    
    if (section) {
      setSelectedPreviousSection(section);
      setFormData(prev => ({
        ...prev,
        section_title: section.section_title,
        previous_section_id: section.id,
        is_revision: true
      }));
    }
  };

  // Handle selecting a section to revise from the list
  const handleSelectSectionToRevise = (section: SectionData) => {
    if (section.status !== 'reviewed') {
      setError("You can only revise sections that have been reviewed.");
      return;
    }
    
    setReviewRevisionMode(true);
    setFormData(prev => ({
      ...prev,
      section_title: section.section_title,
      previous_section_id: section.id,
      is_revision: true
    }));
    setSelectedPreviousSection({
      id: section.id,
      section_title: section.section_title
    });
    setShowFormArea(true);
  };
  
  // New function to show the form area
  const showNewSectionForm = () => {
    setShowFormArea(true);
    setSelectedSection(null);
    setIsCreatingNewSection(true); // Set the flag to prevent auto-selecting first section
    // Reset revision modes
    if (!reviewRevisionMode) {
      setFormData({
        section_title: "",
        user_input: "",
        is_revision: false,
        previous_section_id: ""
      });
    }
  };
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    // Validate
    if (!formData.section_title.trim() || !formData.user_input.trim()) {
      setError("Please fill all required fields");
      return;
    }
    
    if (isRevision && !formData.previous_section_id) {
      setError("Please select a section to revise");
      return;
    }
    
    try {
      setLoading(true);
      setError("");
      setIsCreatingNewSection(false); // Reset the creation mode flag
      
      // Prepare data for submission, converting empty string to null for previous_section_id
      const submissionData = {
        ...formData,
        previous_section_id: formData.previous_section_id || null
      };
      
      // Submit to API
      const createRes = await axios.post(`/api/reviewer/calls/${callId}/sections`, submissionData);
      const newSectionId: string | undefined = createRes?.data?.section?.id;

      // If we have staged assets and a new section id, link them now
      if (newSectionId && stagedAssets.length > 0) {
        const sectionType = currentSectionType();
        try {
          await Promise.all(
            stagedAssets.map((a, index) =>
              axios.post(`/api/reviewer/assets/link`, {
                review_version_id: newSectionId,
                section_type: sectionType,
                asset_id: a.asset_id,
                order: index
              })
            )
          );
        } catch (linkErr) {
          console.error("Failed to link one or more assets", linkErr);
        }
      }

      // Redirect back to call details after linking
      router.push(`/reviewer/${callId}`);
    } catch (err) {
      console.error("Error creating section:", err);
      setError("Failed to create section. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  // Show loading state
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Group sections by title for display
  const sectionsByTitle = existingSections.reduce((acc: any, section: SectionData) => {
    if (!acc[section.section_title]) {
      acc[section.section_title] = [];
    }
    acc[section.section_title].push(section);
    return acc;
  }, {});
  
  // Check if any sections exist
  const hasSections = Object.entries(sectionsByTitle).length > 0;
  
  // Get review JSON data
  const reviewJson = selectedSection?.ai_review_json || {};
  const hasReview = selectedSection?.status === "reviewed" && Object.keys(reviewJson).length > 0;
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>{isRevision ? "Revise Section" : "Add New Section"} - AI Grant Reviewer</title>
        <meta
          name="description"
          content="Add or revise a proposal section for AI review"
        />
      </Head>
      
      {/* Header */}
      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {isRevision ? "Revise Section" : "Add New Section"}
              </h1>
              <p className="mt-1 text-green-100">
                {isRevision 
                  ? "Submit a revised version of your section based on AI feedback" 
                  : "Submit a section of your proposal for AI review"}
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left column: Existing sections */}
          <div className="lg:col-span-1">
            <div className="bg-white shadow-md rounded-lg p-4 mb-4 sticky top-4">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold">Existing Sections</h2>
                <button
                  onClick={() => {
                    // Clear all existing data and ensure form is shown
                    setFormData({
                      section_title: "",
                      user_input: "",
                      is_revision: false,
                      previous_section_id: ""
                    });
                    setShowFormArea(true); 
                    setIsCreatingNewSection(true);
                    setSelectedSection(null);
                  }}
                  className="inline-flex items-center justify-center bg-blue-600 text-white px-3 py-1 text-sm rounded-md hover:bg-blue-700 transition-colors"
                >
                  Create New Section
                </button>
              </div>
              
              {Object.entries(sectionsByTitle).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(sectionsByTitle).map(([title, sections]) => {
                    // Get the latest version of this section
                    const sortedSections = [...(sections as SectionData[])].sort((a, b) => b.version - a.version);
                    const latestSection = sortedSections[0];
                    const hasReview = latestSection.status === 'reviewed';
                    const isSelected = selectedSection?.id === latestSection.id;
                    
                    return (
                      <div 
                        key={title} 
                        className={`border ${isSelected ? 'border-blue-400' : 'border-gray-200'} rounded-md overflow-hidden`}
                      >
                        <div 
                          className={`${isSelected ? 'bg-blue-50' : 'bg-gray-50'} px-4 py-3 flex justify-between items-center cursor-pointer`}
                          onClick={() => toggleSectionExpand(title)}
                        >
                          <div className="flex items-center">
                            <span className="font-medium">{title}</span>
                            {latestSection.version > 1 && (
                              <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                                v{latestSection.version}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            {hasReview ? (
                              <>
                                <span className="text-sm text-green-600">Reviewed</span>
                                <FaCheck className="text-green-600" />
                              </>
                            ) : (
                              <span className="text-sm text-gray-500">Draft</span>
                            )}
                          </div>
                        </div>
                        
                        {expandedSections[title] && (
                          <div className="px-4 py-3 border-t border-gray-200">
                            <div className="flex justify-between items-center mb-2">
                              <button 
                                onClick={() => handleViewSection(latestSection.id)}
                                className="text-blue-600 flex items-center hover:underline"
                              >
                                <FaEye className="mr-1" /> View Section
                              </button>
                              
                              {latestSection.status === 'draft' ? (
                                <button
                                  onClick={async () => {
                                    try {
                                      await axios.post(`/api/reviewer/calls/${callId}/sections/${latestSection.id}/review`);
                                      // Refresh sections after review
                                      const response = await axios.get(`/api/reviewer/calls/${callId}/sections`);
                                      setExistingSections(response.data.sections || []);
                                    } catch (err) {
                                      console.error("Error reviewing section:", err);
                                    }
                                  }}
                                  className="text-green-600 hover:text-green-700 text-sm flex items-center"
                                >
                                  <FaCheck className="mr-1" /> Review Section
                                </button>
                              ) : hasReview && (
                                <button
                                  onClick={() => handleSelectSectionToRevise(latestSection)}
                                  className="text-amber-600 hover:text-amber-700 text-sm"
                                >
                                  Revise This Section
                                </button>
                              )}
                            </div>
                            
                            {hasReview && latestSection.ai_review_json?.score && (
                              <div className="mt-2 text-sm">
                                <span className="font-medium">Score: </span>
                                <span className="text-blue-700">{latestSection.ai_review_json.score.toFixed(1)}/5</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-500">No sections created yet.</p>
              )}
            </div>
          </div>
          
          {/* Right column: Either section creation form or section content */}
          <div className="lg:col-span-3">
            {showFormArea ? (
              // Section creation form
              <div className="bg-white shadow-md rounded-lg p-5 border-2 border-blue-500">
                {/* Revision toggle */}
                <div className="mb-6 flex items-center">
                  {!reviewRevisionMode && (
                    <button
                      type="button"
                      onClick={toggleRevision}
                      className={`px-4 py-2 rounded-md ${
                        isRevision 
                          ? "bg-amber-100 text-amber-800 border border-amber-300" 
                          : "bg-gray-100 text-gray-800 border border-gray-300"
                      }`}
                    >
                      {isRevision ? "Revising Existing Section" : "Create New Section"}
                    </button>
                  )}
                  
                  {reviewRevisionMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 w-full">
                      <div className="flex items-center">
                        <FaCheck className="text-amber-600 mr-2" />
                        <p className="text-amber-800">
                          Revising <span className="font-medium">{formData.section_title}</span> based on previous review
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {(isRevision && !reviewRevisionMode) && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsRevision(false);
                        setFormData(prev => ({ ...prev, section_title: "", previous_section_id: "", is_revision: false }));
                        setReviewRevisionMode(false);
                      }}
                      className="ml-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel revision
                    </button>
                  )}
                  
                  {reviewRevisionMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewRevisionMode(false);
                        setFormData(prev => ({ ...prev, section_title: "", previous_section_id: "", is_revision: false }));
                        setSelectedPreviousSection(null);
                      }}
                      className="ml-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel revision
                    </button>
                  )}
                </div>
                
                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
                    {error}
                  </div>
                )}
                
                <form onSubmit={handleSubmit}>
                  {(isRevision && !reviewRevisionMode) ? (
                    <div className="mb-6">
                      <label 
                        htmlFor="previous_section" 
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Select Section to Revise *
                      </label>
                      <select
                        id="previous_section"
                        value={formData.previous_section_id}
                        onChange={handlePreviousSectionSelect}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                        required
                      >
                        <option value="">-- Select a section --</option>
                        {previousSections.map(section => (
                          <option key={section.id} value={section.id}>
                            {section.section_title} (Version {section.version})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (!reviewRevisionMode && (
                    <div className="mb-6">
                      <label 
                        htmlFor="section_title" 
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Section Title *
                      </label>
                      <SectionSelector 
                        onSelect={handleSectionSelect} 
                        usedSections={[]} // We allow selecting used sections now for versioning
                      />
                      {formData.section_title && (
                        <div className="mt-2 text-sm text-green-600">
                          Selected: {formData.section_title}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div className="mb-6">
                    <label 
                      htmlFor="user_input" 
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Section Content *
                    </label>
                    {formData.section_title.toLowerCase().includes('budget') ? (
                      <BudgetJustificationEditor
                        value={formData.user_input}
                        onChange={handleTextChange}
                        placeholder="Enter your budget justification details here..."
                        readOnly={false}
                      />
                    ) : (
                      <RichTextEditor
                        value={formData.user_input}
                        onChange={handleTextChange}
                        placeholder="Enter your proposal section content here..."
                      />
                    )}
                    <p className="mt-2 text-sm text-gray-500">
                      {isRevision || reviewRevisionMode
                        ? "Revise your proposal section addressing the previous AI feedback."
                        : "Write or paste the content of your proposal section for AI analysis."}
                    </p>
                  </div>

                  {selectedSectionSupportsAssets() && (
                    <div className="mb-6">
                      <h3 className="text-md font-medium text-gray-800 mb-2">Section Assets</h3>
                      {assetError && (
                        <div className="mb-2 text-sm text-red-600">{assetError}</div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm text-gray-600">Optional: Upload PNG/JPG/WEBP/PDF to support this section</div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                          disabled={assetUploading}
                        >{assetUploading ? 'Uploading…' : 'Select file'}</button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        className="hidden"
                        onChange={e => handleSelectFiles(e.target.files)}
                      />
                      <div
                        className="border-2 border-dashed border-gray-300 rounded p-4 text-center text-gray-500 mb-3"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          const dt = e.dataTransfer;
                          if (dt?.files) handleSelectFiles(dt.files);
                        }}
                      >{assetUploading ? 'Uploading…' : 'Drag & drop to upload (or use Select)'}</div>
                      <div className="space-y-2">
                        {stagedAssets.map(a => (
                          <div key={a.asset_id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                            <div className="flex items-center space-x-3">
                              {a.mime?.startsWith('image/') ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={a.preview_url} alt="preview" className="w-12 h-12 object-cover rounded" />
                              ) : (
                                <div className="w-12 h-12 flex items-center justify-center bg-white border rounded text-xs">PDF</div>
                              )}
                              <div className="text-sm text-gray-700">Staged asset</div>
                            </div>
                            <button type="button" className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded" onClick={() => removeStagedAsset(a.asset_id)} disabled={assetUploading}>Remove</button>
                          </div>
                        ))}
                        {stagedAssets.length === 0 && (
                          <div className="text-sm text-gray-500">No assets added yet.</div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex justify-end">
                    <Link
                      href={`/reviewer/${callId}`}
                      className="mr-4 px-6 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </Link>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                      {loading ? (
                        <>
                          <FaSpinner className="animate-spin mr-2" />
                          {isRevision ? "Submitting Revision..." : "Creating Section..."}
                        </>
                      ) : (
                        <>
                          <FaSave className="mr-2" />
                          {isRevision ? "Submit Revision" : "Save Section"}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : isFetchingSelectedSection ? (
              // Loading state when fetching section details
              <div className="bg-white shadow-md rounded-lg p-6 flex justify-center items-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            ) : selectedSection ? (
              // Selected section content and review
              <div>
                {/* Section content */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-800">{selectedSection.section_title}</h2>
                    {selectedSection.version > 1 && (
                      <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded-full">
                        Version {selectedSection.version}
                      </span>
                    )}
                  </div>
                  
                  <div className="mb-6">
                    <RichTextEditor
                      value={selectedSection.user_input || ""}
                      onChange={() => {}}
                      readOnly={true}
                    />
                  </div>
                  
                  <div className="flex justify-between items-center text-sm text-gray-500">
                    <div className="flex items-center">
                      <FaClock className="mr-1" />
                      Last updated: {selectedSection.last_reviewed_at ? new Date(selectedSection.last_reviewed_at).toLocaleString() : 'N/A'}
                    </div>
                    
                    {selectedSection.status === "reviewed" && (
                      <div>
                        <button
                          onClick={() => handleSelectSectionToRevise(selectedSection)}
                          className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-md hover:bg-amber-200 transition-colors"
                        >
                          <FaEdit className="inline-block mr-1" />
                          Revise Section
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                  
                {/* AI Review */}
                {hasReview && (
                  <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">AI Review</h2>
                    
                    {/* Score */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-700 mb-2">Score</h3>
                      <div className="bg-blue-50 p-4 rounded-md">
                        <div className="flex items-end">
                          <span className="text-3xl font-bold text-blue-700">{reviewJson.score?.toFixed(1) || 'N/A'}</span>
                          <span className="text-gray-500 ml-1">/5</span>
                        </div>
                        
                        {selectedSection.is_revision && reviewJson.improvement_over_previous && (
                          <div className="mt-2 text-green-600 text-sm">
                            ✓ Improved over previous version
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Summary */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-700 mb-2">Summary</h3>
                      <div className="bg-gray-50 p-4 rounded-md">
                        <p className="text-gray-800">{reviewJson.summary || 'No summary provided'}</p>
                      </div>
                    </div>
                    
                    {/* Strengths */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-700 mb-2">Strengths</h3>
                      <div className="bg-green-50 p-4 rounded-md">
                        {Array.isArray(reviewJson.strengths) && reviewJson.strengths.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {reviewJson.strengths.map((strength: any, idx: number) => (
                              <li key={idx} className="text-gray-800">{renderSafely(strength)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-gray-600 italic">No strengths identified</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Weaknesses */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-700 mb-2">Weaknesses</h3>
                      <div className="bg-red-50 p-4 rounded-md">
                        {Array.isArray(reviewJson.weaknesses) && reviewJson.weaknesses.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {reviewJson.weaknesses.map((weakness: any, idx: number) => (
                              <li key={idx} className="text-gray-800">{renderSafely(weakness)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-gray-600 italic">No weaknesses identified</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Suggestions */}
                    <div>
                      <h3 className="text-lg font-medium text-gray-700 mb-2">Suggestions</h3>
                      <div className="bg-amber-50 p-4 rounded-md">
                        {Array.isArray(reviewJson.recommendations) && reviewJson.recommendations.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {reviewJson.recommendations.map((suggestion: any, idx: number) => (
                              <li key={idx} className="text-gray-800">{renderSafely(suggestion)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-gray-600 italic">No suggestions provided</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Show the form directly instead of a placeholder when no section is selected
              <div className="bg-white shadow-md rounded-lg p-6 border-2 border-blue-500">
                {/* Revision toggle */}
                <div className="mb-6 flex items-center">
                  {!reviewRevisionMode && (
                    <button
                      type="button"
                      onClick={toggleRevision}
                      className={`px-4 py-2 rounded-md ${
                        isRevision 
                          ? "bg-amber-100 text-amber-800 border border-amber-300" 
                          : "bg-gray-100 text-gray-800 border border-gray-300"
                      }`}
                    >
                      {isRevision ? "Revising Existing Section" : "Create New Section"}
                    </button>
                  )}
                  
                  {reviewRevisionMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 w-full">
                      <div className="flex items-center">
                        <FaCheck className="text-amber-600 mr-2" />
                        <p className="text-amber-800">
                          Revising <span className="font-medium">{formData.section_title}</span> based on previous review
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {(isRevision && !reviewRevisionMode) && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsRevision(false);
                        setFormData(prev => ({ ...prev, section_title: "", previous_section_id: "", is_revision: false }));
                        setReviewRevisionMode(false);
                      }}
                      className="ml-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel revision
                    </button>
                  )}
                  
                  {reviewRevisionMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewRevisionMode(false);
                        setFormData(prev => ({ ...prev, section_title: "", previous_section_id: "", is_revision: false }));
                        setSelectedPreviousSection(null);
                      }}
                      className="ml-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel revision
                    </button>
                  )}
                </div>
                
                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
                    {error}
                  </div>
                )}
                
                <form onSubmit={handleSubmit}>
                  {(isRevision && !reviewRevisionMode) ? (
                    <div className="mb-6">
                      <label 
                        htmlFor="previous_section" 
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Select Section to Revise *
                      </label>
                      <select
                        id="previous_section"
                        value={formData.previous_section_id}
                        onChange={handlePreviousSectionSelect}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                        required
                      >
                        <option value="">-- Select a section --</option>
                        {previousSections.map(section => (
                          <option key={section.id} value={section.id}>
                            {section.section_title} (Version {section.version})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (!reviewRevisionMode && (
                    <div className="mb-6">
                      <label 
                        htmlFor="section_title" 
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Section Title *
                      </label>
                      <SectionSelector 
                        onSelect={handleSectionSelect} 
                        usedSections={[]} // We allow selecting used sections now for versioning
                      />
                      {formData.section_title && (
                        <div className="mt-2 text-sm text-green-600">
                          Selected: {formData.section_title}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div className="mb-6">
                    <label 
                      htmlFor="user_input" 
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Section Content *
                    </label>
                    {formData.section_title.toLowerCase().includes('budget') ? (
                      <BudgetJustificationEditor
                        value={formData.user_input}
                        onChange={handleTextChange}
                        placeholder="Enter your budget justification details here..."
                        readOnly={false}
                      />
                    ) : (
                      <RichTextEditor
                        value={formData.user_input}
                        onChange={handleTextChange}
                        placeholder="Enter your proposal section content here..."
                      />
                    )}
                    <p className="mt-2 text-sm text-gray-500">
                      {isRevision || reviewRevisionMode
                        ? "Revise your proposal section addressing the previous AI feedback."
                        : "Write or paste the content of your proposal section for AI analysis."}
                    </p>
                  </div>

                  {selectedSectionSupportsAssets() && (
                    <div className="mb-6">
                      <h3 className="text-md font-medium text-gray-800 mb-2">Section Assets</h3>
                      {assetError && (
                        <div className="mb-2 text-sm text-red-600">{assetError}</div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm text-gray-600">Optional: Upload PNG/JPG/WEBP/PDF to support this section</div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                          disabled={assetUploading}
                        >{assetUploading ? 'Uploading…' : 'Select file'}</button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        className="hidden"
                        onChange={e => handleSelectFiles(e.target.files)}
                      />
                      <div
                        className="border-2 border-dashed border-gray-300 rounded p-4 text-center text-gray-500 mb-3"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          const dt = e.dataTransfer;
                          if (dt?.files) handleSelectFiles(dt.files);
                        }}
                      >{assetUploading ? 'Uploading…' : 'Drag & drop to upload (or use Select)'}</div>
                      <div className="space-y-2">
                        {stagedAssets.map(a => (
                          <div key={a.asset_id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                            <div className="flex items-center space-x-3">
                              {a.mime?.startsWith('image/') ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={a.preview_url} alt="preview" className="w-12 h-12 object-cover rounded" />
                              ) : (
                                <div className="w-12 h-12 flex items-center justify-center bg-white border rounded text-xs">PDF</div>
                              )}
                              <div className="text-sm text-gray-700">Staged asset</div>
                            </div>
                            <button type="button" className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded" onClick={() => removeStagedAsset(a.asset_id)} disabled={assetUploading}>Remove</button>
                          </div>
                        ))}
                        {stagedAssets.length === 0 && (
                          <div className="text-sm text-gray-500">No assets added yet.</div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex justify-end">
                    <Link
                      href={`/reviewer/${callId}`}
                      className="mr-4 px-6 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </Link>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                      {loading ? (
                        <>
                          <FaSpinner className="animate-spin mr-2" />
                          {isRevision ? "Submitting Revision..." : "Creating Section..."}
                        </>
                      ) : (
                        <>
                          <FaSave className="mr-2" />
                          {isRevision ? "Submit Revision" : "Save Section"}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
} 