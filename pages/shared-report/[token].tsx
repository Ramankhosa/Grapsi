// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import Head from 'next/head';
import { compareSections, compareSectionTitles } from '@/lib/reviewer/sectionGrouping';
import { 
  FaCheck, 
  FaTimes, 
  FaExclamationTriangle, 
  FaThumbsUp, 
  FaThumbsDown,
  FaPrint,
  FaColumns
} from 'react-icons/fa';

interface SectionReview {
  id: string;
  section_title: string;
  user_input: string;
  version: number;
  ai_review_json: {
    score: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions?: string[];
    recommendations?: string[];
  };
  status: string;
  last_reviewed_at: string;
  context_summary?: string;
}

interface OverallReview {
  overall_score: number;
  executive_summary: string;
  major_strengths: string[];
  major_weaknesses: string[];
  cross_sectional_recommendations: string[];
}

// Type for report preferences
interface ReportPreferences {
  displayMode: 'single' | 'parallel';
  versionSelections: Record<string, number>;
  lastUpdated: string;
}

// Type for grouped sections
interface GroupedSections {
  [title: string]: SectionReview[];
}

// Helper function to safely access nested properties
const safeAccess = (obj: any, path: string, fallback: any = undefined) => {
  try {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj) || fallback;
  } catch (e) {
    console.error(`Error accessing path ${path}:`, e);
    return fallback;
  }
};

// Helper function to ensure arrays
const ensureArray = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value]; // Convert non-array to single-item array
};

// Extracts the most meaningful text content from an object
const extractTextContent = (obj: any): string => {
  if (obj === null || obj === undefined) return '';
  
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return obj.toString();
  if (typeof obj === 'boolean') return obj.toString();
  
  if (typeof obj === 'object') {
    // Check for common text properties that might contain the main content
    const textProperties = ['text', 'content', 'description', 'value', 'title', 'name', 'message'];
    
    for (const prop of textProperties) {
      if (obj[prop] !== undefined && typeof obj[prop] === 'string') {
        return obj[prop];
      }
    }
    
    // If no common properties found, check if it's a complex object with point/detail structure
    if (obj.point || obj.detail) {
      const parts = [];
      if (obj.point) parts.push(String(obj.point));
      if (obj.detail) parts.push(String(obj.detail));
      return parts.join(': ');
    }
    
    // Last resort, stringify the object
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '[Complex Object]';
    }
  }
  
  return String(obj);
};

// Function to check if content is HTML
const isHtmlContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(content);
};

// SafeRender component to handle any type of value
function SafeRender({ value }: { value: any }) {
  if (value === undefined) return <span className="text-gray-400">[undefined]</span>;
  if (value === null) return <span className="text-gray-400">[null]</span>;
  
  if (typeof value === 'object') {
    const textContent = extractTextContent(value);
    return <span>{textContent}</span>;
  }
  
  // Check if the value is HTML content
  if (typeof value === 'string' && isHtmlContent(value)) {
    return <div dangerouslySetInnerHTML={{ __html: value }} />;
  }
  
  return <span>{String(value)}</span>;
}

export default function SharedReport() {
  const router = useRouter();
  const { token } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [callData, setCallData] = useState<any>(null);
  const [sections, setSections] = useState<SectionReview[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [displayMode, setDisplayMode] = useState<'single' | 'parallel'>('single');
  const [groupedSections, setGroupedSections] = useState<GroupedSections>({});
  const [fetchAttempted, setFetchAttempted] = useState<boolean>(false);
  
  useEffect(() => {
    if (!token || fetchAttempted) return;

    const fetchSharedReport = async () => {
      try {
        setLoading(true);
        setFetchAttempted(true);
        
        // Add debug logging to see exactly what's happening with the API request
        console.log(`Fetching shared report with token: ${token}`);
        
        // Fetch the shared report data using the token
        const response = await axios.get(`/api/shared-report/${token}`);
        
        if (!response.data || !response.data.call) {
          setError('Report not found or no longer available');
          setLoading(false);
          return;
        }
        
        const reportData = response.data.call;
        
        // Normalize the overall_review_json to ensure it has the expected structure
        if (!reportData.overall_review_json) {
          setError('This report is missing review data');
          setLoading(false);
          return;
        }

        // Ensure overall_review_json is properly formatted
        let normalizedOverallReview: OverallReview;
        try {
          const reviewJson = typeof reportData.overall_review_json === 'string' 
            ? JSON.parse(reportData.overall_review_json) 
            : reportData.overall_review_json;
            
          normalizedOverallReview = {
            overall_score: typeof reviewJson.overall_score === 'number' ? reviewJson.overall_score : 0,
            executive_summary: typeof reviewJson.executive_summary === 'string' ? reviewJson.executive_summary : '',
            major_strengths: ensureArray(reviewJson.major_strengths),
            major_weaknesses: ensureArray(reviewJson.major_weaknesses),
            cross_sectional_recommendations: ensureArray(reviewJson.cross_sectional_recommendations)
          };
          
          // Update the report data with normalized review
          reportData.overall_review_json = normalizedOverallReview;
        } catch (e) {
          console.error('Error normalizing overall review JSON:', e);
          setError('Error processing report data');
          setLoading(false);
          return;
        }
        
        // Normalize section data
        const normalizedSections = (response.data.sections || []).map((section: any) => {
          try {
            // Ensure ai_review_json has the expected structure
            const reviewJson = typeof section.ai_review_json === 'string'
              ? JSON.parse(section.ai_review_json)
              : (section.ai_review_json || {});
              
            return {
              ...section,
              ai_review_json: {
                score: typeof reviewJson.score === 'number' ? reviewJson.score : 0,
                summary: typeof reviewJson.summary === 'string' ? reviewJson.summary : '',
                strengths: ensureArray(reviewJson.strengths).map(item => String(item)),
                weaknesses: ensureArray(reviewJson.weaknesses).map(item => String(item)),
                suggestions: ensureArray(reviewJson.suggestions).map(item => String(item)),
                recommendations: ensureArray(reviewJson.recommendations).map(item => String(item))
              }
            };
          } catch (e) {
            console.error(`Error normalizing section ${section.id}:`, e);
            // Return section with empty review data
            return {
              ...section,
              ai_review_json: {
                score: 0,
                summary: 'Error loading review data',
                strengths: [],
                weaknesses: [],
                suggestions: [],
                recommendations: []
              }
            };
          }
        });
        
        setCallData(reportData);
        setSections(normalizedSections || []);
        
        // Initialize expanded states
        const initialExpanded: Record<string, boolean> = {};
        normalizedSections.forEach((section: SectionReview) => {
          initialExpanded[section.id] = false;
        });
        setExpandedSections(initialExpanded);
        
        // Check if there's a display mode preference
        let parsedJson: any = {};
        try {
          parsedJson = typeof reportData.parsed_json === 'string'
            ? JSON.parse(reportData.parsed_json || '{}')
            : (reportData.parsed_json || {});
        } catch (e) {
          console.error('Error parsing call JSON:', e);
          parsedJson = {};
        }
        
        const reportPreferences = parsedJson?.report_preferences as ReportPreferences | undefined;
        if (reportPreferences?.displayMode) {
          setDisplayMode(reportPreferences.displayMode);
        }
        
        // Group sections by title for parallel view
        const grouped: GroupedSections = {};
        normalizedSections.forEach((section: SectionReview) => {
          if (!grouped[section.section_title]) {
            grouped[section.section_title] = [];
          }
          grouped[section.section_title].push(section);
        });
        
        // Sort versions within each group
        Object.keys(grouped).forEach(title => {
          grouped[title].sort((a, b) => b.version - a.version);
        });
        
        setGroupedSections(grouped);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching shared report:', err);
        setError(`Failed to load the shared report: ${err.message}`);
        setLoading(false);
      }
    };

    fetchSharedReport();
  }, [token]);

  const toggleSectionExpand = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const getSortedSections = (sectionsList: SectionReview[]) => {
    return [...sectionsList].sort(compareSections);
  };

  const getSortedGroupedSections = () => {
    return Object.entries(groupedSections)
      .sort(([titleA], [titleB]) => compareSectionTitles(titleA, titleB));
  };

  const calculateScores = () => {
    const sectionScores = sections.map(s => {
      return {
        id: s.id,
        title: s.section_title,
        score: s.ai_review_json?.score || 0,
        maxScore: 10 // Assuming all sections are scored out of 10
      };
    });
    
    const totalScore = sectionScores.reduce((acc, s) => acc + s.score, 0);
    const maxPossibleScore = sectionScores.reduce((acc, s) => acc + s.maxScore, 0);
    const overallPercentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
    
    return { sectionScores, totalScore, maxPossibleScore, overallPercentage };
  };

  const getStarRating = (score: number, maxScore: number = 5) => {
    const fullStars = Math.floor(score);
    const hasHalfStar = score - fullStars >= 0.5;
    const emptyStars = Math.floor(maxScore - score - (hasHalfStar ? 1 : 0));
    
    return (
      <div className="flex text-amber-400">
        {[...Array(fullStars)].map((_, i) => <span key={`full-${i}`}>★</span>)}
        {hasHalfStar && <span>✩</span>}
        {[...Array(emptyStars)].map((_, i) => <span key={`empty-${i}`} className="text-gray-300">☆</span>)}
      </div>
    );
  };

  const getScoreColor = (score: number, maxScore: number = 10) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-blue-600';
    if (percentage >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSectionBorderColor = (score: number, maxScore: number = 10) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'border-green-500';
    if (percentage >= 60) return 'border-blue-500';
    if (percentage >= 40) return 'border-yellow-500';
    return 'border-red-500';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Error</h2>
          <p className="mb-6 text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  const overallReview = callData?.overall_review_json as OverallReview;
  const scores = calculateScores();
  const sortedSections = getSortedSections(sections);

  return (
    <div id="top" className="min-h-screen bg-gray-50">
      <Head>
        <title>{callData?.project_title || 'Grant Proposal Review'}</title>
        <meta name="description" content="Shared grant proposal review report" />
        <meta name="robots" content="noindex" /> {/* Don't index shared reports */}
      </Head>

      {/* Header */}
      <header className="bg-gradient-to-r from-purple-800 to-purple-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Final Review Report</h1>
              <p className="mt-1 text-purple-100">
                {callData?.project_title}
              </p>
              {displayMode === 'parallel' && (
                <p className="mt-1 text-purple-100 flex items-center">
                  <FaColumns className="mr-1" />
                  <span>Parallel Comparison View</span>
                </p>
              )}
            </div>
            <div>
              <button 
                onClick={() => window.print()}
                className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
              >
                <FaPrint className="mr-2" />
                Print Report
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:py-2">
        {/* Overall Score Card */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8 print:shadow-none">
          <div className="bg-gradient-to-r from-purple-700 to-indigo-600 px-6 py-4 print:bg-purple-700">
            <h2 className="text-xl font-bold text-white">Overall Assessment</h2>
          </div>
          
          <div className="p-6">
            <div className="flex flex-wrap justify-between items-center mb-6 print:flex-col print:items-start">
              <div className="flex flex-col">
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-purple-700">
                    {scores.overallPercentage.toFixed(1)}%
                  </span>
                  <span className="text-lg text-gray-500 ml-2">
                    ({scores.totalScore.toFixed(1)} / {scores.maxPossibleScore})
                  </span>
                </div>
                <div className="mt-1">
                  {getStarRating(scores.overallPercentage / 20)} {/* Convert percentage to 5-star scale */}
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4 mt-4 print:mt-2">
                <div className="bg-blue-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-gray-500">Sections</span>
                  <p className="text-xl font-semibold text-blue-700">{sections.length}</p>
                </div>
                <div className="bg-green-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-gray-500">Strengths</span>
                  <p className="text-xl font-semibold text-green-700">{overallReview?.major_strengths?.length || 0}</p>
                </div>
                <div className="bg-red-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-gray-500">Weaknesses</span>
                  <p className="text-xl font-semibold text-red-700">{overallReview?.major_weaknesses?.length || 0}</p>
                </div>
                <div className="bg-amber-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-gray-500">Recommendations</span>
                  <p className="text-xl font-semibold text-amber-700">
                    {overallReview?.cross_sectional_recommendations?.length || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Executive Summary */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Executive Summary</h3>
              <div className="bg-gray-50 p-4 rounded-md">
                <p className="text-gray-700 whitespace-pre-line">{overallReview?.executive_summary}</p>
              </div>
            </div>

            {/* Major Strengths */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center mr-2">
                  <FaThumbsUp className="text-white text-xs" />
                </div>
                Major Strengths
              </h3>
              <div className="bg-green-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview?.major_strengths?.map((strength, index) => (
                    <li key={`strength-${index}`} className="flex">
                      <FaCheck className="text-green-500 mt-1 mr-2 flex-shrink-0" />
                      <span className="text-gray-800"><SafeRender value={strength} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Major Weaknesses */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center mr-2">
                  <FaThumbsDown className="text-white text-xs" />
                </div>
                Major Weaknesses
              </h3>
              <div className="bg-red-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview?.major_weaknesses?.map((weakness, index) => (
                    <li key={`weakness-${index}`} className="flex">
                      <FaTimes className="text-red-500 mt-1 mr-2 flex-shrink-0" />
                      <span className="text-gray-800"><SafeRender value={weakness} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Cross-Sectional Recommendations */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center mr-2">
                  <FaExclamationTriangle className="text-white text-xs" />
                </div>
                Cross-Sectional Recommendations
              </h3>
              <div className="bg-amber-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview?.cross_sectional_recommendations?.map((recommendation, index) => (
                    <li key={`recommendation-${index}`} className="flex">
                      <span className="text-amber-500 font-bold mr-2">→</span>
                      <span className="text-gray-800"><SafeRender value={recommendation} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Section Index */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8 print:shadow-none">
          <div className="bg-gradient-to-r from-indigo-700 to-indigo-500 px-6 py-4 print:bg-indigo-700">
            <h2 className="text-xl font-bold text-white">Table of Contents</h2>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-medium text-gray-700 mb-2">Jump to Section:</h3>
                {displayMode === 'single' ? (
                  <ol className="list-decimal list-inside space-y-1 pl-2">
                    {getSortedSections(sections).map((section) => (
                      <li key={section.id} className="text-blue-600 hover:text-blue-800">
                        <a href={`#section-${section.id}`} className="hover:underline">
                          {section.section_title}
                          <span className="text-gray-500 text-sm ml-2">
                            (v{section.version || 1}: {section.ai_review_json?.score?.toFixed(1) || "0.0"}/10)
                          </span>
                        </a>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 pl-2">
                    {getSortedGroupedSections().map(([title, sections]) => (
                      <li key={title} className="text-blue-600 hover:text-blue-800">
                        <a href={`#section-${title}`} className="hover:underline">
                          {title}
                          <span className="text-gray-500 text-sm ml-2">
                            ({sections.length} versions)
                          </span>
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sections Score Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8 print:shadow-none print:break-before-page">
          <div className="bg-gradient-to-r from-blue-700 to-blue-500 px-6 py-4 print:bg-blue-700">
            <h2 className="text-xl font-bold text-white">Section Scores</h2>
          </div>
          
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Section
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rating
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Version
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedSections.map((section) => {
                    const score = section.ai_review_json?.score || 0;
                    const maxScore = 10; // Assuming each section is scored out of 10
                    const scoreColor = getScoreColor(score, maxScore);
                    
                    return (
                      <tr 
                        key={section.id}
                        className="cursor-pointer hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center">
                            <a href={displayMode === 'single' ? `#section-${section.id}` : `#section-${section.section_title}`} className="font-medium text-blue-600 hover:text-blue-800 hover:underline">
                              {section.section_title}
                            </a>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className={`font-semibold ${scoreColor}`}>
                            {score.toFixed(1)}/{maxScore}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getStarRating(score, maxScore)}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          v{section.version || 1}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Individual Sections */}
        {displayMode === 'single' ? (
          // Single view mode
          sortedSections.map((section) => {
            const score = section.ai_review_json?.score || 0;
            const maxScore = 10;
            const borderColor = getSectionBorderColor(score, maxScore);
            const scoreColor = getScoreColor(score, maxScore);
            
            return (
              <div 
                key={section.id}
                id={`section-${section.id}`}
                className="bg-white rounded-lg shadow-lg overflow-hidden mb-8 print:shadow-none print:break-before-page"
              >
                <div className={`border-t-4 ${borderColor}`}>
                  <div className="px-6 py-4 bg-gray-50 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">{section.section_title}</h2>
                    <div className="flex items-center">
                      <div className={`font-bold text-lg ${scoreColor} mr-3`}>
                        {score.toFixed(1)}/{maxScore}
                      </div>
                      <div className="text-sm text-gray-500">
                        Version {section.version || 1}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    {/* Content */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Content</h3>
                      <div 
                        className={`border ${borderColor} p-4 rounded-md overflow-hidden relative ${expandedSections[section.id] ? '' : 'max-h-32'}`}
                        style={{ transition: 'max-height 0.3s ease-in-out' }}
                      >
                        {!expandedSections[section.id] && (
                          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent"></div>
                        )}
                        <div className="text-gray-800 whitespace-pre-line">
                          <SafeRender value={section.user_input} />
                        </div>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSectionExpand(section.id);
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                      >
                        {expandedSections[section.id] ? 'Show Less' : 'Show More'}
                      </button>
                    </div>
                    
                    {/* Summary */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Summary</h3>
                      <div className="bg-gray-50 p-4 rounded-md">
                        <p className="text-gray-700">{section.ai_review_json?.summary}</p>
                      </div>
                    </div>
                    
                    {/* Strengths */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mr-2">
                          <FaCheck className="text-white text-xs" />
                        </div>
                        Strengths
                      </h3>
                      <div className="bg-green-50 p-4 rounded-md">
                        <ul className="space-y-1">
                          {section.ai_review_json?.strengths?.map((strength, idx) => (
                            <li key={idx} className="flex">
                              <span className="text-green-500 mr-2">•</span>
                              <span className="text-gray-700"><SafeRender value={strength} /></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Weaknesses */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                        <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center mr-2">
                          <FaTimes className="text-white text-xs" />
                        </div>
                        Weaknesses
                      </h3>
                      <div className="bg-red-50 p-4 rounded-md">
                        <ul className="space-y-1">
                          {section.ai_review_json?.weaknesses?.map((weakness, idx) => (
                            <li key={idx} className="flex">
                              <span className="text-red-500 mr-2">•</span>
                              <span className="text-gray-700"><SafeRender value={weakness} /></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Recommendations or Suggestions */}
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                        <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center mr-2">
                          <span className="text-white text-xs font-bold">!</span>
                        </div>
                        Recommendations
                      </h3>
                      <div className="bg-amber-50 p-4 rounded-md">
                        <ul className="space-y-1">
                          {(section.ai_review_json?.suggestions || section.ai_review_json?.recommendations || []).map((rec, idx) => (
                            <li key={idx} className="flex">
                              <span className="text-amber-500 mr-2">→</span>
                              <span className="text-gray-700"><SafeRender value={rec} /></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Back to Top link */}
                    <div className="mt-6 text-right">
                      <a 
                        href="#top" 
                        className="inline-flex items-center text-blue-600 hover:text-blue-800"
                      >
                        <span className="mr-1">Back to Top</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          // Parallel view mode
          getSortedGroupedSections().map(([title, sectionVersions]) => (
            <div 
              key={title}
              id={`section-${title}`}
              className="bg-white rounded-lg shadow-lg overflow-hidden mb-8 print:shadow-none print:break-before-page"
            >
              <div className="border-t-4 border-blue-500">
                <div className="px-6 py-4 bg-gray-50">
                  <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                  <p className="text-sm text-gray-500">Comparing {sectionVersions.length} versions</p>
                </div>
                
                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {sectionVersions.map((section) => {
                      const score = section.ai_review_json?.score || 0;
                      const maxScore = 10;
                      const borderColor = getSectionBorderColor(score, maxScore);
                      const scoreColor = getScoreColor(score, maxScore);
                      
                      return (
                        <div key={section.id} className={`border ${borderColor} rounded-md overflow-hidden`}>
                          <div className="px-4 py-2 bg-gray-50 flex justify-between items-center border-b">
                            <h3 className="font-medium text-gray-800">Version {section.version}</h3>
                            <div className={`font-bold ${scoreColor}`}>
                              {score.toFixed(1)}/{maxScore}
                            </div>
                          </div>
                          
                          <div className="p-4">
                            {/* Content */}
                            <div className="mb-4">
                              <h4 className="font-medium text-gray-700 mb-1">Content</h4>
                              <div 
                                className={`border border-gray-200 p-3 rounded-md overflow-hidden relative ${expandedSections[section.id] ? '' : 'max-h-32'}`}
                              >
                                {!expandedSections[section.id] && (
                                  <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent"></div>
                                )}
                                <div className="text-gray-800 whitespace-pre-line text-sm">
                                  <SafeRender value={section.user_input} />
                                </div>
                              </div>
                              
                              <button
                                onClick={() => toggleSectionExpand(section.id)}
                                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                              >
                                {expandedSections[section.id] ? 'Show Less' : 'Show More'}
                              </button>
                            </div>
                            
                            {/* Summary */}
                            <div className="mb-4">
                              <h4 className="font-medium text-gray-700 mb-1">Summary</h4>
                              <div className="bg-gray-50 p-3 rounded-md">
                                <p className="text-gray-700 text-sm">{section.ai_review_json?.summary}</p>
                              </div>
                            </div>
                            
                            {/* Key Points */}
                            <div>
                              <div className="grid grid-cols-1 gap-2">
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-1 flex items-center">
                                    <FaCheck className="text-green-500 mr-1" />
                                    Strengths
                                  </h4>
                                  <div className="bg-green-50 p-2 rounded-md">
                                    <ul className="space-y-1 text-sm">
                                      {section.ai_review_json?.strengths?.slice(0, 3).map((strength, idx) => (
                                        <li key={idx} className="text-gray-700"><SafeRender value={strength} /></li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                                
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-1 flex items-center">
                                    <FaTimes className="text-red-500 mr-1" />
                                    Weaknesses
                                  </h4>
                                  <div className="bg-red-50 p-2 rounded-md">
                                    <ul className="space-y-1 text-sm">
                                      {section.ai_review_json?.weaknesses?.slice(0, 3).map((weakness, idx) => (
                                        <li key={idx} className="text-gray-700"><SafeRender value={weakness} /></li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Back to Top link */}
                  <div className="mt-6 text-right">
                    <a 
                      href="#top" 
                      className="inline-flex items-center text-blue-600 hover:text-blue-800"
                    >
                      <span className="mr-1">Back to Top</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        
        {/* Footer */}
        <div className="text-center text-gray-500 text-sm py-6 print:hidden">
          <p>Generated by GrantGenie</p>
        </div>
      </main>
    </div>
  );
} 