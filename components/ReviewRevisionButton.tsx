// @ts-nocheck
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { FaEdit, FaSpinner, FaClipboardCheck, FaHistory, FaEye } from "react-icons/fa";

interface ReviewRevisionButtonProps {
  callId: string;
}

interface Section {
  id: string;
  section_title: string;
  status: string;
  version: number;
}

export default function ReviewRevisionButton({ callId }: ReviewRevisionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionVersions, setSectionVersions] = useState<Record<string, Section[]>>({});
  const [error, setError] = useState("");
  const [showVersionHistory, setShowVersionHistory] = useState<Record<string, boolean>>({});
  
  // Get all reviewed sections
  useEffect(() => {
    const fetchReviewedSections = async () => {
      try {
        const response = await axios.get(`/api/reviewer/calls/${callId}/sections`);
        
        // Cast the sections data to the correct type
        const allSections = (response.data.sections || []) as Section[];
        
        // Filter to only show reviewed sections
        const reviewedSections = allSections.filter(section => section.status === "reviewed");
        
        // Group by section_title and sort by version
        const sectionsByTitle: Record<string, Section[]> = {};
        
        for (const section of reviewedSections) {
          if (!sectionsByTitle[section.section_title]) {
            sectionsByTitle[section.section_title] = [];
          }
          sectionsByTitle[section.section_title].push(section);
        }
        
        // Sort each section group by version
        for (const title in sectionsByTitle) {
          sectionsByTitle[title].sort((a, b) => b.version - a.version);
        }
        
        // Store all versions for each section title
        setSectionVersions(sectionsByTitle);
        
        // Get the latest version of each section title for the main list
        const latestSections: Section[] = [];
        
        for (const sectionGroup of Object.values(sectionsByTitle)) {
          if (sectionGroup.length > 0) {
            latestSections.push(sectionGroup[0]); // First item is the latest after sorting
          }
        }
        
        setSections(latestSections);
      } catch (err) {
        console.error("Error fetching sections:", err);
        setError("Failed to load sections");
      }
    };
    
    if (callId) {
      fetchReviewedSections();
    }
  }, [callId]);
  
  // Navigate to revision page for the selected section with correct mode
  const handleReviseSection = (sectionId: string, directRevision: boolean = false) => {
    if (directRevision) {
      // Direct revision mode - will copy content for immediate editing and review
      router.push(`/reviewer/${callId}/section/new?revision=true&sectionId=${sectionId}&directRevision=true`);
    } else {
      // Standard revision mode - start from scratch with previous version as reference
      router.push(`/reviewer/${callId}/section/new?revision=true&sectionId=${sectionId}`);
    }
  };
  
  // View a specific version of a section
  const handleViewVersion = (sectionId: string) => {
    router.push(`/reviewer/${callId}/section/${sectionId}`);
  };
  
  // Toggle showing version history for a section
  const toggleVersionHistory = (sectionTitle: string) => {
    setShowVersionHistory(prev => ({
      ...prev,
      [sectionTitle]: !prev[sectionTitle]
    }));
  };
  
  // If no reviewed sections, don't show the button
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowOptions(!showOptions)}
        className="w-full bg-amber-100 text-amber-700 px-4 py-2 rounded text-center hover:bg-amber-200 transition-colors flex items-center justify-center"
        disabled={loading}
      >
        {loading ? (
          <>
            <FaSpinner className="animate-spin mr-2" />
            Loading...
          </>
        ) : (
          <>
            <FaEdit className="mr-2" />
            Revise Section
          </>
        )}
      </button>
      
      {showOptions && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10">
          <div className="p-2 border-b border-gray-200 bg-gray-50">
            <span className="text-sm font-medium text-gray-700">Select Section to Revise</span>
          </div>
          
          <div className="max-h-64 overflow-y-auto">
            {sections.map((section) => (
              <div key={section.id} className="border-b border-gray-100">
                <div className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center">
                    <span>{section.section_title}</span>
                    {section.version > 1 && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                        v{section.version}
                      </span>
                    )}
                  </div>
                  
                  {section.version > 1 && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVersionHistory(section.section_title);
                      }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <FaHistory size={14} />
                    </button>
                  )}
                </div>
                
                {/* Version history dropdown */}
                {showVersionHistory[section.section_title] && sectionVersions[section.section_title]?.length > 0 && (
                  <div className="bg-gray-50 px-4 py-2 border-t border-gray-100">
                    <h4 className="text-xs font-medium text-gray-500 mb-2">Version History</h4>
                    {sectionVersions[section.section_title].map((version) => (
                      <div key={version.id} className="flex items-center justify-between py-1">
                        <span className="text-sm">
                          Version {version.version}
                          {version.id === section.id && <span className="text-xs ml-2 text-gray-500">(Latest)</span>}
                        </span>
                        <button
                          onClick={() => handleViewVersion(version.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                        >
                          <FaEye size={12} className="mr-1" />
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="flex border-t border-gray-50">
                  <button
                    className="flex-1 text-sm text-center py-1 text-green-600 hover:bg-green-50"
                    onClick={() => {
                      handleReviseSection(section.id, true);
                      setShowOptions(false);
                    }}
                  >
                    <FaClipboardCheck className="inline mr-1" size={12} />
                    Review Revision
                  </button>
                  
                  <div className="bg-gray-200" style={{ width: '1px' }}></div>
                  
                  <button
                    className="flex-1 text-sm text-center py-1 text-amber-600 hover:bg-amber-50"
                    onClick={() => {
                      handleReviseSection(section.id, false);
                      setShowOptions(false);
                    }}
                  >
                    <FaEdit className="inline mr-1" size={12} />
                    Start Fresh
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 