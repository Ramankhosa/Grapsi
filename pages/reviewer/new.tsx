// @ts-nocheck
import { useState, useRef, FormEvent } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaArrowLeft, FaSpinner, FaLink, FaUpload, FaFileAlt, FaExclamationTriangle } from "react-icons/fa";
import { toast } from "react-hot-toast";

export default function NewReviewerCall() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    project_title: "",
    agency_name: "",
    call_input_type: "url" as "url" | "file" | "text",
    call_input_data: "",
  });
  
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [draftSaved, setDraftSaved] = useState(false);
  
  // Redirect if not authenticated
  if (status === "unauthenticated") {
    router.push("/login");
  }

  const validateUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    
    if (!formData.project_title.trim()) {
      errors.project_title = "Project title is required";
    }
    
    if (!formData.agency_name.trim()) {
      errors.agency_name = "Agency name is required";
    }
    
    if (formData.call_input_type === "url") {
      if (!formData.call_input_data.trim()) {
        errors.call_input_data = "URL is required";
      } else if (!validateUrl(formData.call_input_data)) {
        errors.call_input_data = "Invalid URL format";
      }
    } else if (formData.call_input_type === "file") {
      if (!file) {
        errors.file = "File is required";
      }
    } else if (formData.call_input_type === "text") {
      if (!formData.call_input_data.trim()) {
        errors.call_input_data = "Text content is required";
      } else if (formData.call_input_data.trim().length < 50) {
        errors.call_input_data = "Text content is too short";
      }
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear validation error for this field
    if (validationErrors[name]) {
      setValidationErrors(prev => ({
        ...prev,
        [name]: ""
      }));
    }
    
    // Auto-save draft
    if (name !== "call_input_type") {
      handleSaveDraft();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setValidationErrors(prev => ({
        ...prev,
        file: ""
      }));
      handleSaveDraft();
    }
  };

  const handleInputTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as "url" | "file" | "text";
    setFormData(prev => ({
      ...prev,
      call_input_type: value,
      call_input_data: value === "file" ? "" : prev.call_input_data
    }));
  };
  
  const handleSaveDraft = () => {
    // Save current form data to localStorage
    const draftData = {
      ...formData,
      has_file: !!file,
      file_name: file?.name || ""
    };
    
    localStorage.setItem("reviewer_draft", JSON.stringify(draftData));
    setDraftSaved(true);
    
    // Clear draft saved message after 2 seconds
    setTimeout(() => {
      setDraftSaved(false);
    }, 2000);
  };
  
  const handleLoadDraft = () => {
    const savedDraft = localStorage.getItem("reviewer_draft");
    if (savedDraft) {
      try {
        const parsedDraft = JSON.parse(savedDraft);
        setFormData({
          project_title: parsedDraft.project_title || "",
          agency_name: parsedDraft.agency_name || "",
          call_input_type: parsedDraft.call_input_type || "url",
          call_input_data: parsedDraft.call_input_data || "",
        });
        
        if (parsedDraft.has_file && fileInputRef.current) {
          // Can't restore actual file due to security limitations, 
          // but we can inform the user
          setValidationErrors(prev => ({
            ...prev,
            file: `Please reselect your file (${parsedDraft.file_name})`
          }));
        }
      } catch (err) {
        console.error("Error loading draft:", err);
        setError("Failed to load draft data");
      }
    } else {
      setError("No draft found");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    setError("");
    setProgress(5);
    
    try {
      // Create a FormData object if we have a file
      let data;
      let contentType = "application/json";
      
      if (formData.call_input_type === "file" && file) {
        data = new FormData();
        data.append("project_title", formData.project_title);
        data.append("agency_name", formData.agency_name);
        data.append("call_input_type", formData.call_input_type);
        data.append("file", file);
        contentType = "multipart/form-data";
      } else {
        data = {
          project_title: formData.project_title,
          agency_name: formData.agency_name,
          call_input_type: formData.call_input_type,
          call_input_data: formData.call_input_data
        };
      }
      
      setProgress(10);
      
      // First validate the URL if using URL input type
      if (formData.call_input_type === "url") {
        setProgress(20);
        try {
          const validateResponse = await axios.post("/api/reviewer/validate-url", {
            url: formData.call_input_data
          });
          
          if (!validateResponse.data.valid) {
            setValidationErrors(prev => ({
              ...prev,
              call_input_data: validateResponse.data.message || "Invalid URL"
            }));
            setLoading(false);
            return;
          }
          
          // Show warning if there is one but continue with submission
          if (validateResponse.data.warning) {
            toast(validateResponse.data.warning, {
              duration: 5000,
              icon: '⚠️',
            });
          }
          
          setProgress(30);
        } catch (error) {
          console.error("Error validating URL:", error);
          // If validation API fails, still allow submission but show a warning
          toast("Could not fully validate the URL, but continuing with submission", {
            duration: 5000,
            icon: '⚠️',
          });
          setProgress(30);
        }
      }
      
      // Submit the data for processing
      const response = await axios.post("/api/reviewer/calls/analyze", data, {
        headers: {
          "Content-Type": contentType
        },
        onUploadProgress: (progressEvent) => {
          if (formData.call_input_type === "file" && progressEvent.total) {
            // Calculate upload progress for files
            const percentCompleted = Math.round(
              (progressEvent.loaded * 40) / progressEvent.total
            ) + 30; // Start at 30%, max at 70%
            setProgress(percentCompleted);
          }
        }
      });
      
      // Show LLM processing progress
      setProgress(70);
      
      // Poll for status updates
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await axios.get(`/api/reviewer/calls/${response.data.call_id}/status`);
          
          if (statusResponse.data.status === "parsed") {
            clearInterval(pollInterval);
            setProgress(100);
            // Clear draft from local storage
            localStorage.removeItem("reviewer_draft");
            // Redirect to the reviewer detail page
            router.push(`/reviewer/${response.data.call_id}`);
          } else if (statusResponse.data.status === "failed") {
            clearInterval(pollInterval);
            setError("Analysis failed: " + (statusResponse.data.message || "Unknown error"));
            setLoading(false);
          } else {
            // Update progress based on status
            setProgress(70 + Math.floor(Math.random() * 20)); // Random progress between 70-90%
          }
        } catch (err) {
          console.error("Error polling status:", err);
        }
      }, 2000);
      
    } catch (err) {
      console.error("Error submitting call:", err);
      setError("Failed to process funding call. Please try again.");
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>Review New Project - AI Grant Reviewer</title>
        <meta
          name="description"
          content="Submit a funding call for AI-powered analysis"
        />
      </Head>

      {/* Header */}
      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Review New Project</h1>
              <p className="mt-1 text-green-100">
                Submit a funding call to analyze requirements and eligibility
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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Draft management */}
        <div className="flex justify-between items-center mb-6">
          <button 
            type="button" 
            onClick={handleLoadDraft}
            className="text-sm text-green-600 hover:text-green-800"
          >
            Load saved draft
          </button>
          {draftSaved && (
            <span className="text-sm text-gray-500">Draft saved</span>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="bg-white shadow-md rounded-lg p-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6 flex items-center">
              <FaExclamationTriangle className="mr-2" />
              {error}
            </div>
          )}
          
          {/* Project Information */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Project Information</h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="project_title" className="block text-sm font-medium text-gray-700 mb-1">
                  Project Title*
                </label>
                <input
                  type="text"
                  id="project_title"
                  name="project_title"
                  value={formData.project_title}
                  onChange={handleInputChange}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                    validationErrors.project_title ? "border-red-300" : "border-gray-300"
                  }`}
                  placeholder="Enter your project title"
                />
                {validationErrors.project_title && (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.project_title}</p>
                )}
              </div>
              
              <div>
                <label htmlFor="agency_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Funding Agency*
                </label>
                <input
                  type="text"
                  id="agency_name"
                  name="agency_name"
                  value={formData.agency_name}
                  onChange={handleInputChange}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                    validationErrors.agency_name ? "border-red-300" : "border-gray-300"
                  }`}
                  placeholder="Enter funding agency name"
                />
                {validationErrors.agency_name && (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.agency_name}</p>
                )}
              </div>
            </div>
          </div>
          
          {/* Call Input */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Funding Call Details</h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="call_input_type" className="block text-sm font-medium text-gray-700 mb-1">
                  Input Method*
                </label>
                <select
                  id="call_input_type"
                  name="call_input_type"
                  value={formData.call_input_type}
                  onChange={handleInputTypeChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                >
                  <option value="url">URL Link</option>
                  <option value="file">File Upload</option>
                  <option value="text">Paste Text</option>
                </select>
              </div>
              
              {formData.call_input_type === "url" && (
                <div>
                  <label htmlFor="call_input_data" className="block text-sm font-medium text-gray-700 mb-1">
                    Funding Call URL*
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FaLink className="text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="call_input_data"
                      name="call_input_data"
                      value={formData.call_input_data}
                      onChange={handleInputChange}
                      className={`w-full pl-10 px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                        validationErrors.call_input_data ? "border-red-300" : "border-gray-300"
                      }`}
                      placeholder="https://funding-agency.gov/call/example"
                    />
                  </div>
                  {validationErrors.call_input_data && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.call_input_data}</p>
                  )}
                </div>
              )}
              
              {formData.call_input_type === "file" && (
                <div>
                  <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
                    Upload Funding Call Document*
                  </label>
                  <div 
                    className={`border-2 border-dashed rounded-md p-4 text-center hover:bg-gray-50 cursor-pointer ${
                      validationErrors.file ? "border-red-300" : "border-gray-300"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      id="file"
                      name="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.txt"
                    />
                    <div className="flex flex-col items-center">
                      <FaUpload className="text-gray-400 text-2xl mb-2" />
                      {file ? (
                        <span className="text-gray-700">{file.name}</span>
                      ) : (
                        <span className="text-gray-500">Click to upload PDF, Word, or text file</span>
                      )}
                    </div>
                  </div>
                  {validationErrors.file && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.file}</p>
                  )}
                </div>
              )}
              
              {formData.call_input_type === "text" && (
                <div>
                  <label htmlFor="call_input_data" className="block text-sm font-medium text-gray-700 mb-1">
                    Paste Funding Call Text*
                  </label>
                  <div className="relative">
                    <div className="absolute top-3 left-3 text-gray-400">
                      <FaFileAlt />
                    </div>
                    <textarea
                      id="call_input_data"
                      name="call_input_data"
                      value={formData.call_input_data}
                      onChange={handleInputChange}
                      rows={10}
                      className={`w-full pl-10 px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                        validationErrors.call_input_data ? "border-red-300" : "border-gray-300"
                      }`}
                      placeholder="Paste the funding call text here..."
                    ></textarea>
                  </div>
                  {validationErrors.call_input_data && (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.call_input_data}</p>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Submit Button */}
          <div className="mt-8">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white px-4 py-3 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed flex justify-center items-center font-medium"
            >
              {loading ? (
                <>
                  <FaSpinner className="animate-spin mr-2" />
                  Analyzing Call...
                </>
              ) : (
                "Call Analysis"
              )}
            </button>
            
            {/* Progress bar */}
            {loading && (
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500 mt-2 text-center">
                  {progress < 30 ? "Validating input..." :
                   progress < 70 ? "Processing content..." :
                   progress < 100 ? "AI analyzing funding call..." :
                   "Analysis complete!"}
                </p>
              </div>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
