// @ts-nocheck
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import {
  FaArrowLeft, FaSpinner, FaCheck, FaTimes,
  FaStar, FaStarHalfAlt, FaRegStar, FaPrint,
  FaExclamationTriangle, FaThumbsUp, FaThumbsDown, FaFileExport,
  FaColumns, FaList, FaFilter, FaShare, FaLink, FaSyncAlt,
  FaFileWord
} from 'react-icons/fa';
import { extractTextFromHTML } from '../../../lib/services/markdownParserService';
import { ReviewerProse, ReviewerText } from '@/components/reviewer/ReviewerText';
import { SECTION_ORDER } from '@/lib/reviewer/sectionGrouping';
import ReviewerShell from '@/components/reviewer/ReviewerShell';

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
  supplementary_materials?: string[];
  funding_recommendation?: { decision: string; competitiveness: string; rationale: string } | null;
  criterion_scorecard?: Array<{
    criterion: string;
    weight: number | null;
    score: number | null;
    verdict: string;
    evidence_sections: string[];
  }>;
  priority_actions?: Array<{
    rank: number;
    section: string;
    issue: string;
    action: string;
    impact: string;
    effort: string;
    expected_gain: string;
  }>;
  consistency_flags?: Array<{ issue: string; sections: string[]; severity: string }>;
  compliance?: {
    requiredSections?: { covered: string[]; missing: string[]; coveragePercent: number };
    limits?: Array<{ section: string; rule: string; limit: number; unit: string; actual: number; overBy: number; status: string }>;
    deadline?: { date: string | null; daysRemaining: number | null; status: string };
    emptySectionTitles?: string[];
  } | null;
  score_basis?: { weightedScore: number | null; meanSectionScore: number | null; anchorScore: number | null } | null;
}

const DECISION_LABELS: Record<string, string> = {
  fund: 'Fund',
  fund_with_revisions: 'Fund with revisions',
  revise_and_resubmit: 'Revise and resubmit',
  do_not_fund: 'Do not fund',
};

const DECISION_STYLES: Record<string, string> = {
  fund: 'bg-green-100 text-green-900 border-green-300',
  fund_with_revisions: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  revise_and_resubmit: 'bg-amber-50 text-amber-900 border-amber-300',
  do_not_fund: 'bg-red-50 text-red-900 border-red-300',
};

const COMPETITIVENESS_LABELS: Record<string, string> = {
  top_tier: 'Top tier',
  competitive: 'Competitive',
  borderline: 'Borderline',
  not_competitive: 'Not competitive',
};

const IMPACT_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-nickel-100 text-nickel-700',
};

// Group sections by title and version
interface GroupedSections {
  [title: string]: {
    [version: number]: SectionReview;
    versions: number[];
    latestVersion: number;
  };
}

export default function FinalReview() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [callData, setCallData] = useState<any>(null);
  const [allSections, setAllSections] = useState<SectionReview[]>([]);
  const [sections, setSections] = useState<SectionReview[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeneratingATR, setIsGeneratingATR] = useState(false);
  
  // Version selection and comparison state
  const [groupedSections, setGroupedSections] = useState<GroupedSections>({});
  const [displayMode, setDisplayMode] = useState<'single' | 'parallel'>('single');
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({});
  const [compareVersions, setCompareVersions] = useState<Record<string, number[]>>({});
  const [showVersionSelector, setShowVersionSelector] = useState(false);
  const [includedSections, setIncludedSections] = useState<Record<string, boolean>>({});
  
  // Share link state
  const [shareLink, setShareLink] = useState<string>('');
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState<boolean>(false);
  const [shareLinkError, setShareLinkError] = useState<string>('');

  // Function to check if content is HTML
  const isHtmlContent = (content: string): boolean => {
    if (!content || typeof content !== 'string') return false;
    return /<\/?[a-z][\s\S]*>/i.test(content);
  };

  // Reviewer output arrives as markdown-flavoured text (and occasionally as
  // objects). ReviewerText renders the markdown, flattens object shapes, and
  // strips HTML instead of trusting it.
  const renderSafely = (content: any, defaultValue: string = ""): React.ReactNode => (
    <ReviewerText value={content} fallback={defaultValue} />
  );

  const hasMeaningfulClientContent = (value: string) => {
    const text = String(value || '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return /[a-z0-9]/i.test(text);
  };

  const isScorableReviewedSection = (section: any) => {
    if (section.status !== 'reviewed' || !hasMeaningfulClientContent(section.user_input)) return false;
    const links = Array.isArray(section.mappingJson?.linkedSections) ? section.mappingJson.linkedSections : [];
    const declaresWorkflow = links.some((link: any) => typeof link.workflowMode === 'string');
    return !declaresWorkflow || links.some((link: any) => link.workflowMode === 'app_draft');
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }

    if (status !== 'authenticated' || !id) {
      return;
    }

    const fetchFinalReview = async () => {
      try {
        setLoading(true);
        const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
        
        if (!callResponse.data.call?.overall_review_json) {
          setError('No final review is available yet. Please generate a final review first.');
          setLoading(false);
          return;
        }
        
        setCallData(callResponse.data.call);

        // Check if there are saved report preferences
        const reportPreferences = callResponse.data.call?.parsed_json?.report_preferences;
        
        // Fetch all sections (including all versions)
        const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
        console.log('Sections API response:', sectionsResponse.data);
        
        // Ensure each section has the required properties
        const processedSections = sectionsResponse.data.sections.map((section: any) => {
          // Ensure ai_review_json has the required structure
          const safeReviewJson = {
            score: 0,
            summary: '',
            strengths: [],
            weaknesses: [],
            suggestions: [],
            recommendations: [],
            ...(section.ai_review_json || {})
          };

          // Return a complete section object
          return {
            ...section,
            ai_review_json: safeReviewJson,
            user_input: section.user_input || '',
            version: section.version || 1
          };
        });

        const allReviewedSections = processedSections.filter(isScorableReviewedSection);
        
        console.log('Filtered reviewed sections:', allReviewedSections);
        console.log('Is AI review JSON available?', allReviewedSections.map((s: any) => !!s.ai_review_json));
        
        setAllSections(allReviewedSections);

        // Group sections by title and version
        const grouped: GroupedSections = {};
        const initialSelectedVersions: Record<string, number> = {};
        const initialCompareVersions: Record<string, number[]> = {};
        
        allReviewedSections.forEach((section: SectionReview) => {
          const title = section.section_title;
          
          if (!grouped[title]) {
            grouped[title] = {
              versions: [],
              latestVersion: 0
            };
          }
          
          grouped[title][section.version] = section;
          
          if (!grouped[title].versions.includes(section.version)) {
            grouped[title].versions.push(section.version);
          }
          
          // Track the latest version
          if (section.version > grouped[title].latestVersion) {
            grouped[title].latestVersion = section.version;
          }
        });
        
        // Set initial selected versions to the latest version for each section
        // or use saved preferences if available
        Object.keys(grouped).forEach(title => {
          initialSelectedVersions[title] = grouped[title].latestVersion;
          
          // If there are multiple versions, set up for comparison
          if (grouped[title].versions.length > 1) {
            // By default, compare the latest version with the previous version
            const versions = [...grouped[title].versions].sort((a, b) => b - a);
            initialCompareVersions[title] = versions.slice(0, 2);
          }
        });
        
        setGroupedSections(grouped);
        
        // Apply saved preferences if available
        if (reportPreferences?.displayMode && reportPreferences?.versionSelections) {
          setDisplayMode(reportPreferences.displayMode);
          
          // Initialize included sections
          const initialIncludedSections: Record<string, boolean> = {};
          Object.keys(grouped).forEach(title => {
            initialIncludedSections[title] = false;
          });
          
          if (reportPreferences.displayMode === 'single') {
            // For single mode, apply the saved version selections
            const savedSelections = reportPreferences.versionSelections;
            Object.keys(savedSelections).forEach(title => {
              if (grouped[title]) {
                initialSelectedVersions[title] = Number(savedSelections[title]);
                initialIncludedSections[title] = true;
              }
            });
            
            // Set sections based on saved selections
            const selectedSections = Object.keys(savedSelections)
              .filter(title => grouped[title] && grouped[title][savedSelections[title]])
              .map(title => grouped[title][savedSelections[title]]);
            
            if (selectedSections.length > 0) {
              setSections(selectedSections);
            } else {
              // Fallback to defaults if no valid sections found
              setSections(Object.values(grouped).map(group => group[group.latestVersion]));
            }
          } else {
            // For parallel mode, parse the special format (title|version)
            const savedSelections = reportPreferences.versionSelections;
            Object.keys(savedSelections).forEach(key => {
              if (key.includes('|')) {
                const [title, versionStr] = key.split('|');
                if (grouped[title]) {
                  if (!initialCompareVersions[title]) {
                    initialCompareVersions[title] = [];
                  }
                  const version = Number(savedSelections[key]);
                  if (!initialCompareVersions[title].includes(version)) {
                    initialCompareVersions[title].push(version);
                  }
                }
              }
            });
            
            // Set sections to all versions for rendering
            setSections(allReviewedSections);
          }
          
          setSelectedVersions(initialSelectedVersions);
          setCompareVersions(initialCompareVersions);
          setIncludedSections(initialIncludedSections);
        } else {
          // Default to single view unless explicitly set to parallel
          setDisplayMode('single');
          setSelectedVersions(initialSelectedVersions);
          setCompareVersions(initialCompareVersions);
          
          // Initialize all sections as included by default
          const defaultIncludedSections: Record<string, boolean> = {};
          Object.keys(grouped).forEach(title => {
            defaultIncludedSections[title] = true;
          });
          setIncludedSections(defaultIncludedSections);
          
          // Set the initial sections to display (latest versions)
          const latestVersionSections = Object.values(grouped).map(group => 
            group[group.latestVersion]
          );
          
          setSections(latestVersionSections);
        }

        // Initialize all sections as collapsed
        const initialExpanded: Record<string, boolean> = {};
        allReviewedSections.forEach((section: SectionReview) => {
          initialExpanded[section.id] = false;
        });
        setExpandedSections(initialExpanded);

        setLoading(false);
      } catch (err) {
        console.error('Error fetching final review:', err);
        setError('Failed to load final review data');
        setLoading(false);
      }
    };

    fetchFinalReview();
  }, [id, status, router]);

  // Update displayed sections when display mode changes
  useEffect(() => {
    if (displayMode === 'single') {
      // For single mode, show the selected version of each section
      const selectedSections = Object.keys(selectedVersions).map(title => 
        groupedSections[title][selectedVersions[title]]
      ).filter(Boolean);
      
      setSections(selectedSections);
    } else {
      // For parallel mode, we need to update the sections list too
      // This is just to keep the sections state in sync, the actual rendering is done differently
      const latestVersionSections = Object.values(groupedSections).map(group => 
        group[group.latestVersion]
      ).filter(Boolean);
      
      setSections(latestVersionSections);
    }
  }, [displayMode, selectedVersions, groupedSections]);

  const toggleSectionExpand = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleDisplayModeChange = (mode: 'single' | 'parallel') => {
    setDisplayMode(mode);
    
    // If switching to single mode, make sure we update the sections
    if (mode === 'single') {
      const selectedSections = Object.keys(selectedVersions).map(title => 
        groupedSections[title][selectedVersions[title]]
      ).filter(Boolean);
      
      setSections(selectedSections);
    }
  };

  const handleVersionChange = (sectionTitle: string, version: number) => {
    setSelectedVersions(prev => {
      const updated = {
        ...prev,
        [sectionTitle]: version
      };
      
      // Mark this section as included
      setIncludedSections(prev => ({
        ...prev, 
        [sectionTitle]: true
      }));
      
      // Update sections immediately if in single mode
      if (displayMode === 'single') {
        const selectedSections = Object.keys(updated).map(title => 
          groupedSections[title][updated[title]]
        ).filter(Boolean);
        
        setSections(selectedSections);
      }
      
      return updated;
    });
  };

  const handleCompareVersionChange = (sectionTitle: string, versions: number[]) => {
    setCompareVersions(prev => ({
      ...prev,
      [sectionTitle]: versions
    }));
  };

  const toggleVersionSelector = () => {
    setShowVersionSelector(!showVersionSelector);
  };

  // Sort sections according to the predefined order
  const getSortedSections = (sectionsList: SectionReview[]) => {
    return [...sectionsList].sort((a, b) => {
      const aIndex = SECTION_ORDER.indexOf(a.section_title);
      const bIndex = SECTION_ORDER.indexOf(b.section_title);
      
      if (aIndex === -1 && bIndex === -1) {
        return a.section_title.localeCompare(b.section_title);
      }
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      
      return aIndex - bIndex;
    });
  };

  // Calculate total and average scores
  const calculateScores = () => {
    if (!sections || sections.length === 0) {
      return { totalScore: 0, maxPossibleScore: 0, averageScore: 0, overallPercentage: 0 };
    }
    
    const totalScore = sections.reduce((sum, section) => {
      return sum + (section.ai_review_json?.score || 0);
    }, 0);
    
    // Each section is typically scored out of 5 or 10 points
    const maxPossibleScore = sections.length * 10; // Assuming each section is out of 10
    const averageScore = totalScore / sections.length;
    const overallPercentage = (totalScore / maxPossibleScore) * 100;
    
    return { totalScore, maxPossibleScore, averageScore, overallPercentage };
  };

  const scores = calculateScores();
  const overallReview: OverallReview = callData?.overall_review_json || {
    overall_score: 0,
    executive_summary: '',
    major_strengths: [],
    major_weaknesses: [],
    cross_sectional_recommendations: [],
    supplementary_materials: []
  };

  const supplementaryMaterials = Array.from(new Set([
    ...(Array.isArray(overallReview.supplementary_materials) ? overallReview.supplementary_materials : []),
    ...sections.flatMap((section) => [
      ...(Array.isArray(section.ai_review_json?.supplementary_materials) ? section.ai_review_json.supplementary_materials : []),
      ...(Array.isArray(section.ai_review_json?.non_scoring_reminders) ? section.ai_review_json.non_scoring_reminders : []),
    ]),
  ].map((item) => String(item || '').trim()).filter(Boolean)));

  // Generate star rating based on score
  const getStarRating = (score: number, maxScore: number = 5) => {
    const normalizedScore = (score / maxScore) * 5; // Convert to 5-star scale
    const fullStars = Math.floor(normalizedScore);
    const hasHalfStar = normalizedScore % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return (
      <div className="flex text-yellow-500">
        {[...Array(fullStars)].map((_, i) => (
          <FaStar key={`full-${i}`} className="mr-1" />
        ))}
        {hasHalfStar && <FaStarHalfAlt className="mr-1" />}
        {[...Array(emptyStars)].map((_, i) => (
          <FaRegStar key={`empty-${i}`} className="mr-1" />
        ))}
      </div>
    );
  };
  
  const getScoreColor = (score: number, maxScore: number = 10) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-cobalt-700';
    if (percentage >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSectionBorderColor = (score: number, maxScore: number = 10) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return 'border-green-500';
    if (percentage >= 60) return 'border-blue-500';
    if (percentage >= 40) return 'border-yellow-500';
    return 'border-red-300';
  };

  // Function to generate a public share link for the report
  const generateShareLink = async () => {
    if (!id) return;
    
    try {
      setIsGeneratingShareLink(true);
      setShareLinkError('');
      
      // Get the current display preferences to include with the share link
      const sharePreferences = {
        displayMode,
        versionSelections: displayMode === 'single' 
          ? selectedVersions 
          : Object.entries(compareVersions).reduce((acc, [title, versions]) => {
              versions.forEach(version => {
                acc[`${title}|${version}`] = version;
              });
              return acc;
            }, {})
      };
      
      const response = await axios.post(`/api/reviewer/calls/${id}/share-report`, sharePreferences);
      
      if (!response.data?.share_url) {
        throw new Error('Failed to generate share link');
      }
      
      setShareLink(response.data.share_url);
      toast.success('Public share link created successfully!');
    } catch (err) {
      console.error('Error generating share link:', err);
      setShareLinkError('Failed to generate shareable link');
      toast.error('Failed to generate share link');
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  // Function to regenerate the final review
  const regenerateFinalReview = async () => {
    if (!id) return;
    
    try {
      setIsRegenerating(true);
      const response = await axios.post(`/api/reviewer/calls/${id}/final-review`);
      
      if (response.data && response.data.call) {
        setCallData(response.data.call);
        toast.success('Final review regenerated successfully');
      }
    } catch (error) {
      console.error('Error regenerating final review:', error);
      toast.error('Failed to regenerate final review. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Function to generate and download the ATR document
  const generateATR = async () => {
    if (!id) return;

    try {
      setIsGeneratingATR(true);
      toast.loading('Generating Action Taken Report...');
      
      // Open the export URL in a new tab to trigger the download
      window.open(`/api/reviewer/calls/${id}/export-atr`, '_blank');
      
      toast.dismiss();
      toast.success('Action Taken Report generated successfully');
    } catch (error) {
      toast.dismiss();
      toast.error('Failed to generate Action Taken Report. Please try again.');
      console.error('Error generating ATR:', error);
    } finally {
      setIsGeneratingATR(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-nickel-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg  max-w-md w-full">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Error</h2>
          <p className="mb-6 text-nickel-600">{error}</p>
          <div className="flex justify-between">
            <Link href={`/reviewer/${id}`} className="text-cobalt-700 hover:underline">
              Back to Project
            </Link>
            <button 
              onClick={async () => {
                try {
                  setLoading(true);
                  await axios.post(`/api/reviewer/calls/${id}/final-review`);
                  router.reload();
                } catch (err) {
                  console.error('Error generating final review:', err);
                  setError('Failed to generate final review. Make sure all sections are reviewed.');
                  setLoading(false);
                }
              }}
              className="px-4 py-2 bg-cobalt-600 text-white rounded-md hover:bg-cobalt-700"
            >
              Generate Final Review
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReviewerShell
      call={callData || { id }}
      sections={allSections}
      title="Panel report"
      actions={
        <div className="flex items-center gap-1.5">
          {Object.values(groupedSections).some(group => group.versions.length > 1) && (
            <button
              onClick={toggleVersionSelector}
              className="nk-btn-ghost nk-btn-sm"
              aria-expanded={showVersionSelector}
            >
              <FaFilter aria-hidden="true" /> Versions
            </button>
          )}
          <button onClick={() => window.print()} className="nk-btn-ghost nk-btn-sm">
            <FaPrint aria-hidden="true" /> Print
          </button>
          <button
            onClick={generateATR}
            disabled={isGeneratingATR}
            className="nk-btn-ghost nk-btn-sm"
            title="Generate an Action Taken Report as a Word document"
          >
            <FaFileWord aria-hidden="true" /> {isGeneratingATR ? 'Building…' : 'ATR'}
          </button>
          <button
            onClick={generateShareLink}
            disabled={isGeneratingShareLink}
            className="nk-btn-secondary nk-btn-sm"
          >
            <FaShare aria-hidden="true" /> {isGeneratingShareLink ? 'Generating…' : 'Share'}
          </button>
          <button
            onClick={regenerateFinalReview}
            disabled={isRegenerating}
            className="nk-btn-primary nk-btn-sm"
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      }
    >
      <div id="top" className="space-y-6">
      {/* Version selection, lifted out of the old header — it was styled for a
          dark purple band and is a body-level control, not page chrome. */}
          {showVersionSelector && (
            <div className="mt-4 bg-white/10 p-4 rounded-md">
              <div className="mb-4">
                <h2 className="text-lg font-medium text-white mb-2">Display Options</h2>
                <div className="flex space-x-4">
                  <button
                    onClick={() => handleDisplayModeChange('single')}
                    className={`flex items-center px-3 py-2 rounded ${
                      displayMode === 'single' 
                        ? 'bg-white text-purple-800' 
                        : 'bg-white/20 text-white'
                    }`}
                  >
                    <FaList className="mr-2" />
                    Single Version View
                  </button>
                  
                  <button
                    onClick={() => handleDisplayModeChange('parallel')}
                    className={`flex items-center px-3 py-2 rounded ${
                      displayMode === 'parallel' 
                        ? 'bg-white text-purple-800' 
                        : 'bg-white/20 text-white'
                    }`}
                  >
                    <FaColumns className="mr-2" />
                    Parallel Comparison
                  </button>
                </div>
              </div>
              
              <div>
                <h2 className="text-lg font-medium text-white mb-2">
                  {displayMode === 'single' ? 'Select Sections and Versions' : 'Select Versions to Compare'}
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(groupedSections).map(([title, group]) => (
                    <div key={title} className="bg-white/5 p-3 rounded">
                      <h3 className="text-white font-medium mb-2">{title}</h3>
                      
                      {displayMode === 'single' ? (
                        <div className="space-y-2">
                          <div className="flex items-center mb-2">
                            <input
                              type="checkbox"
                              id={`${title}-single-include`}
                              checked={includedSections[title] || false}
                              onChange={(e) => {
                                setIncludedSections(prev => ({
                                  ...prev,
                                  [title]: e.target.checked
                                }));
                              }}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor={`${title}-single-include`} className="text-white text-sm">
                              Include in report
                            </label>
                          </div>
                          <select
                            value={selectedVersions[title] || group.latestVersion}
                            onChange={(e) => handleVersionChange(title, Number(e.target.value))}
                            className="w-full bg-white/20 text-white border border-white/30 rounded px-3 py-1"
                          >
                            {group.versions.sort((a, b) => b - a).map(version => (
                              <option key={version} value={version}>
                                Version {version}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center mb-2">
                            <input
                              type="checkbox"
                              id={`${title}-parallel-include`}
                              checked={includedSections[title] || false}
                              onChange={(e) => {
                                setIncludedSections(prev => ({
                                  ...prev,
                                  [title]: e.target.checked
                                }));
                                
                                // If unchecked, clear all version selections for this title
                                if (!e.target.checked) {
                                  handleCompareVersionChange(title, []);
                                } else if (compareVersions[title]?.length === 0) {
                                  // If checked and no versions selected, select the latest two versions
                                  const versions = [...group.versions].sort((a, b) => b - a);
                                  handleCompareVersionChange(title, versions.slice(0, 2));
                                }
                              }}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor={`${title}-parallel-include`} className="text-white text-sm">
                              Include in report
                            </label>
                          </div>
                          {group.versions.map(version => (
                            <div key={version} className="flex items-center">
                              <input
                                type="checkbox"
                                id={`${title}-v${version}`}
                                checked={compareVersions[title]?.includes(version)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    // Add to comparison (max 2)
                                    const current = compareVersions[title] || [];
                                    if (current.length < 2) {
                                      handleCompareVersionChange(title, [...current, version]);
                                    } else {
                                      // Replace the oldest version
                                      handleCompareVersionChange(title, [current[1], version]);
                                    }
                                    
                                    // Make sure the section inclusion checkbox is checked
                                    const includeCheckbox = document.getElementById(`${title}-parallel-include`) as HTMLInputElement;
                                    if (includeCheckbox) includeCheckbox.checked = true;
                                  } else {
                                    // Remove from comparison
                                    const current = compareVersions[title] || [];
                                    handleCompareVersionChange(title, current.filter(v => v !== version));
                                  }
                                }}
                                className="mr-2 h-4 w-4"
                              />
                              <label htmlFor={`${title}-v${version}`} className="text-white text-sm">
                                Version {version}
                              </label>
                            </div>
                          ))}
                          {(compareVersions[title]?.length || 0) > 2 && (
                            <p className="text-yellow-200 text-xs">
                              Only 2 versions can be compared at once
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={async () => {
                      try {
                        setLoading(true);
                        
                        // Create version selections object for API
                        const versionSelections = {};
                        
                        if (displayMode === 'single') {
                          // For single mode, only include sections that are explicitly selected
                          Object.keys(selectedVersions).forEach(title => {
                            // Only include sections that are checked in the UI
                            if (includedSections[title]) {
                              versionSelections[title] = selectedVersions[title];
                            }
                          });
                        } else {
                          // For parallel mode, only include sections with selected versions for comparison
                          Object.keys(compareVersions).forEach(title => {
                            // Only include sections that are checked and have versions selected for comparison
                            if (includedSections[title] && compareVersions[title]?.length > 0) {
                              // Use all selected versions for this section
                              compareVersions[title].forEach(version => {
                                // Add each version as a separate entry with a special key format
                                versionSelections[`${title}|${version}`] = version;
                              });
                            }
                          });
                        }
                        
                        // Check if any sections were selected
                        if (Object.keys(versionSelections).length === 0) {
                          setError('Please select at least one section to include in the report');
                          setLoading(false);
                          return;
                        }
                        
                        // Generate a new report with the selected versions
                        await axios.post(`/api/reviewer/calls/${id}/final-review`, {
                          versionSelections,
                          displayMode // Pass the display mode to the API
                        });
                        
                        // Reload the page to show the new report
                        router.reload();
                      } catch (err) {
                        console.error('Error generating custom report:', err);
                        setError('Failed to generate custom report with selected versions');
                        setLoading(false);
                      }
                    }}
                    className="px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 transition-colors"
                  >
                    Generate Report with Selected Versions
                  </button>
                </div>
              </div>
            </div>
          )}


      {/* Share link dialog */}
      {shareLink && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="p-4 bg-cobalt-50 border border-cobalt-200 rounded-lg">
            <h3 className="flex items-center text-lg font-medium text-cobalt-800 mb-2">
              <FaLink className="mr-2" /> Public Share Link
            </h3>
            <p className="text-sm text-cobalt-700 mb-2">
              Anyone with this link can view your report without requiring login:
            </p>
            <div className="flex">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 p-2 border border-blue-300 rounded-l-md"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareLink);
                  toast.success('Link copied to clipboard!');
                }}
                className="bg-cobalt-600 text-white px-4 py-2 rounded-r-md hover:bg-cobalt-700"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-blue-500 mt-2">
              This link will remain active as long as you keep this report public.
            </p>
          </div>
        </div>
      )}

      {shareLinkError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600">{shareLinkError}</p>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="print:py-2">
        {/* Overall Score Card */}
        <div className="nk-panel overflow-hidden mb-8 print:shadow-none">
          <div className="bg-nickel-800 px-6 py-4 print:bg-nickel-800 flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Overall Assessment</h2>
            <button
              onClick={regenerateFinalReview}
              disabled={isRegenerating}
              className="inline-flex items-center px-3 py-2 border border-white shadow-sm text-sm leading-4 font-medium rounded-md text-white bg-cobalt-600 hover:bg-cobalt-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50"
            >
              {isRegenerating ? (
                <>
                  <FaSpinner className="animate-spin h-4 w-4 mr-2" />
                  Regenerating...
                </>
              ) : (
                <>
                  <FaSyncAlt className="h-4 w-4 mr-2" />
                  Regenerate Review
                </>
              )}
            </button>
          </div>
          
          <div className="p-6">
            <div className="flex flex-wrap justify-between items-center mb-6 print:flex-col print:items-start">
              <div className="flex flex-col">
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-purple-700">
                    {scores.overallPercentage.toFixed(1)}%
                  </span>
                  <span className="text-lg text-nickel-500 ml-2">
                    ({scores.totalScore.toFixed(1)} / {scores.maxPossibleScore})
                  </span>
                </div>
                <div className="mt-1">
                  {getStarRating(scores.overallPercentage / 20)} {/* Convert percentage to 5-star scale */}
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4 mt-4 print:mt-2">
                <div className="bg-cobalt-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-nickel-500">Sections</span>
                  <p className="text-xl font-semibold text-cobalt-700">{sections.length}</p>
                </div>
                <div className="bg-green-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-nickel-500">Strengths</span>
                  <p className="text-xl font-semibold text-green-700">{overallReview.major_strengths.length}</p>
                </div>
                <div className="bg-red-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-nickel-500">Weaknesses</span>
                  <p className="text-xl font-semibold text-red-700">{overallReview.major_weaknesses.length}</p>
                </div>
                <div className="bg-amber-50 px-4 py-2 rounded-md">
                  <span className="text-sm text-nickel-500">Recommendations</span>
                  <p className="text-xl font-semibold text-amber-700">
                    {overallReview.cross_sectional_recommendations.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Funding verdict */}
            {overallReview.funding_recommendation ? (
              <div
                className={`mt-2 rounded-lg border-2 p-4 ${
                  DECISION_STYLES[overallReview.funding_recommendation.decision] || 'border-nickel-300 bg-nickel-50'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-bold">
                    {DECISION_LABELS[overallReview.funding_recommendation.decision] || 'Reviewer verdict'}
                  </span>
                  <span className="rounded-full bg-white/70 px-3 py-1 text-sm font-medium">
                    {COMPETITIVENESS_LABELS[overallReview.funding_recommendation.competitiveness] ||
                      overallReview.funding_recommendation.competitiveness}
                  </span>
                  {overallReview.score_basis?.weightedScore != null ? (
                    <span className="text-sm opacity-80">
                      Weighted score {overallReview.score_basis.weightedScore.toFixed(2)}/10
                    </span>
                  ) : null}
                </div>
                {overallReview.funding_recommendation.rationale ? (
                  <p className="mt-2 text-sm">{overallReview.funding_recommendation.rationale}</p>
                ) : null}
              </div>
            ) : null}

            {/* Executive Summary */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-nickel-900 mb-2">Executive Summary</h3>
              <div className="bg-nickel-50 p-4 rounded-md">
                <ReviewerProse
                  value={overallReview.executive_summary}
                  fallback="No executive summary provided."
                  className="text-nickel-700"
                />
              </div>
            </div>

            {/* Compliance check (computed, not model-generated) */}
            {overallReview.compliance ? (
              <div className="mt-6">
                <h3 className="text-lg font-medium text-nickel-900 mb-2">Compliance Check</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-nickel-200 p-4">
                    <div className="text-sm text-nickel-500">Required sections drafted</div>
                    <div className="mt-1 text-2xl font-semibold text-nickel-900">
                      {overallReview.compliance.requiredSections?.coveragePercent ?? 100}%
                    </div>
                    {overallReview.compliance.requiredSections?.missing?.length ? (
                      <ul className="mt-2 list-inside list-disc text-sm text-red-700">
                        {overallReview.compliance.requiredSections.missing.map((item, index) => (
                          <li key={`missing-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-green-700">All required sections are present.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-nickel-200 p-4">
                    <div className="text-sm text-nickel-500">Length limits</div>
                    {overallReview.compliance.limits?.length ? (
                      <ul className="mt-2 space-y-1 text-sm">
                        {overallReview.compliance.limits
                          .filter((limit) => limit.status !== 'within')
                          .map((limit, index) => (
                            <li key={`limit-${index}`} className={limit.status === 'over' ? 'text-red-700' : 'text-amber-700'}>
                              {limit.section}: {limit.actual.toLocaleString()} / {limit.limit.toLocaleString()} {limit.unit}
                              {limit.overBy > 0 ? ` (over by ${limit.overBy.toLocaleString()})` : ' (near cap)'}
                            </li>
                          ))}
                        {overallReview.compliance.limits.every((limit) => limit.status === 'within') ? (
                          <li className="text-green-700">
                            All {overallReview.compliance.limits.length} checked sections are within their caps.
                          </li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-nickel-500">The call did not state numeric length limits.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-nickel-200 p-4">
                    <div className="text-sm text-nickel-500">Deadline</div>
                    {overallReview.compliance.deadline?.date ? (
                      <>
                        <div className="mt-1 text-lg font-semibold text-nickel-900">
                          {new Date(overallReview.compliance.deadline.date).toLocaleDateString()}
                        </div>
                        <p
                          className={`mt-1 text-sm ${
                            overallReview.compliance.deadline.status === 'passed'
                              ? 'text-red-700'
                              : overallReview.compliance.deadline.status === 'closing'
                                ? 'text-amber-700'
                                : 'text-nickel-600'
                          }`}
                        >
                          {overallReview.compliance.deadline.status === 'passed'
                            ? 'This deadline has passed.'
                            : `${overallReview.compliance.deadline.daysRemaining} days remaining`}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-nickel-500">No deadline recorded for this call.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Criterion scorecard */}
            {overallReview.criterion_scorecard?.length ? (
              <div className="mt-6">
                <h3 className="text-lg font-medium text-nickel-900 mb-2">Scorecard Against the Call's Criteria</h3>
                <div className="overflow-x-auto rounded-md border border-nickel-200">
                  <table className="min-w-full divide-y divide-nickel-200 text-sm">
                    <thead className="bg-nickel-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Criterion</th>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Weight</th>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Score</th>
                        <th className="px-4 py-2 text-left font-medium text-nickel-700">Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-nickel-200">
                      {overallReview.criterion_scorecard.map((row, index) => (
                        <tr key={`criterion-${index}`}>
                          <td className="px-4 py-2 text-nickel-900">{row.criterion}</td>
                          <td className="px-4 py-2 text-nickel-600">{row.weight !== null ? row.weight : '—'}</td>
                          <td className="px-4 py-2 font-medium text-nickel-900">
                            {row.score !== null ? `${row.score.toFixed(1)}/10` : 'Not evidenced'}
                          </td>
                          <td className="px-4 py-2 text-nickel-700">
                            {row.verdict}
                            {row.evidence_sections?.length ? (
                              <span className="ml-1 text-xs text-nickel-500">({row.evidence_sections.join(', ')})</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Priority actions */}
            {overallReview.priority_actions?.length ? (
              <div className="mt-6">
                <h3 className="text-lg font-medium text-nickel-900 mb-2">What to Fix First</h3>
                <ol className="space-y-3">
                  {overallReview.priority_actions.map((action, index) => (
                    <li key={`action-${index}`} className="rounded-md border border-nickel-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                          {action.rank}
                        </span>
                        {action.section ? (
                          <span className="font-medium text-nickel-900">{action.section}</span>
                        ) : null}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${IMPACT_STYLES[action.impact] || 'bg-nickel-100 text-nickel-700'}`}>
                          {action.impact} impact
                        </span>
                        <span className="rounded-full bg-nickel-100 px-2 py-0.5 text-xs text-nickel-700">
                          {action.effort} effort
                        </span>
                      </div>
                      {action.issue ? <p className="mt-2 text-sm text-nickel-600">{action.issue}</p> : null}
                      <p className="mt-1 text-nickel-900">{action.action}</p>
                      {action.expected_gain ? (
                        <p className="mt-1 text-sm text-green-700">Expected gain: {action.expected_gain}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {/* Cross-section consistency */}
            {overallReview.consistency_flags?.length ? (
              <div className="mt-6">
                <h3 className="text-lg font-medium text-nickel-900 mb-2">Cross-Section Consistency</h3>
                <ul className="space-y-2">
                  {overallReview.consistency_flags.map((flag, index) => (
                    <li
                      key={`consistency-${index}`}
                      className={`rounded-md p-3 ${
                        flag.severity === 'high'
                          ? 'bg-red-50'
                          : flag.severity === 'medium'
                            ? 'bg-amber-50'
                            : 'bg-nickel-50'
                      }`}
                    >
                      <span className="text-nickel-900">{flag.issue}</span>
                      {flag.sections?.length ? (
                        <span className="ml-2 text-xs text-nickel-500">{flag.sections.join(' ↔ ')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Major Strengths */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center mr-2">
                  <FaThumbsUp className="text-white text-xs" />
                </div>
                Major Strengths
              </h3>
              <div className="bg-green-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview.major_strengths.map((strength, index) => (
                    <li key={`strength-${index}`} className="flex">
                      <FaCheck className="text-green-500 mt-1 mr-2 flex-shrink-0" />
                      <span className="text-nickel-800">
                        {renderSafely(strength)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Major Weaknesses */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center mr-2">
                  <FaThumbsDown className="text-white text-xs" />
                </div>
                Major Weaknesses
              </h3>
              <div className="bg-red-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview.major_weaknesses.map((weakness, index) => (
                    <li key={`weakness-${index}`} className="flex">
                      <FaTimes className="text-red-500 mt-1 mr-2 flex-shrink-0" />
                      <span className="text-nickel-800">
                        {renderSafely(weakness)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Cross-Sectional Recommendations */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center mr-2">
                  <FaExclamationTriangle className="text-white text-xs" />
                </div>
                Cross-Sectional Recommendations
              </h3>
              <div className="bg-amber-50 rounded-md p-4">
                <ul className="space-y-2">
                  {overallReview.cross_sectional_recommendations.map((recommendation, index) => (
                    <li key={`recommendation-${index}`} className="flex">
                      <span className="text-amber-500 font-bold mr-2">→</span>
                      <span className="text-nickel-800">
                        {renderSafely(recommendation)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Recommended Supplementary Materials */}
            {supplementaryMaterials.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center mr-2">
                    <FaFileExport className="text-white text-xs" />
                  </div>
                  Recommended Supplementary Materials
                </h3>
                <div className="bg-cobalt-50 rounded-md p-4">
                  <ul className="space-y-2">
                    {supplementaryMaterials.map((material, index) => (
                      <li key={`supplementary-${index}`} className="flex">
                        <FaCheck className="text-blue-500 mt-1 mr-2 flex-shrink-0" />
                        <span className="text-nickel-800">
                          {renderSafely(material)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section Index */}
        <div className="nk-panel overflow-hidden mb-8 print:shadow-none">
          <div className="bg-nickel-800 px-6 py-4 print:bg-nickel-800">
            <h2 className="text-xl font-bold text-white">Table of Contents</h2>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-medium text-nickel-700 mb-2">Jump to Section:</h3>
                {displayMode === 'single' ? (
                  // Single mode - show selected versions
                  sections && sections.length > 0 ? (
                    getSortedSections(sections).map((section, index) => (
                      <li key={section.id} className="text-cobalt-700 hover:text-cobalt-800">
                        <a href={`#section-${section.id}`} className="hover:underline">
                          {renderSafely(section.section_title, "Untitled Section")}
                          <span className="text-nickel-500 text-sm ml-2">
                            (v{section.version || 1}: {section.ai_review_json?.score?.toFixed(1) || "0.0"}/10)
                          </span>
                        </a>
                      </li>
                    ))
                  ) : (
                    <div className="nk-panel p-6 mb-8">
                      <p className="text-center text-nickel-500">No reviewed sections are available. Please review at least one section.</p>
                    </div>
                  )
                ) : (
                  // Parallel mode - group by section title
                  <ol className="list-decimal list-inside space-y-1 pl-2">
                    {Object.entries(groupedSections)
                      .sort(([titleA], [titleB]) => {
                        const aIndex = SECTION_ORDER.indexOf(titleA);
                        const bIndex = SECTION_ORDER.indexOf(titleB);
                        
                        if (aIndex === -1 && bIndex === -1) {
                          return titleA.localeCompare(titleB);
                        }
                        if (aIndex === -1) return 1;
                        if (bIndex === -1) return -1;
                        
                        return aIndex - bIndex;
                      })
                      .map(([title, group]) => {
                        // Get the versions to compare
                        const versionsToCompare = compareVersions[title] || 
                          (group.versions.length > 1 
                            ? [group.versions.sort((a, b) => b - a)[0], group.versions.sort((a, b) => b - a)[1]] 
                            : [group.latestVersion]);
                        
                        // Get version numbers as string
                        const versionStr = versionsToCompare
                          .sort((a, b) => b - a)
                          .map(v => `v${v}`)
                          .join(', ');
                        
                        return (
                          <li key={title} className="text-cobalt-700 hover:text-cobalt-800">
                            <a href={`#section-${title}`} className="hover:underline">
                              {renderSafely(title, "Untitled Section")}
                              <span className="text-nickel-500 text-sm ml-2">
                                ({versionStr})
                              </span>
                            </a>
                          </li>
                        );
                      })
                    }
                  </ol>
                )}
              </div>
              
              <div className="bg-nickel-50 p-4 rounded-md">
                <h3 className="font-medium text-nickel-700 mb-2">Section Score Legend:</h3>
                <div className="space-y-2">
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
                    <span className="text-sm">80-100% - Excellent</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
                    <span className="text-sm">60-79% - Good</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-yellow-500 rounded-full mr-2"></div>
                    <span className="text-sm">40-59% - Needs Improvement</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
                    <span className="text-sm">0-39% - Inadequate</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Section Scores Overview */}
        <div className="nk-panel overflow-hidden mb-8 print:shadow-none print:break-before-page">
          <div className="bg-nickel-800 px-6 py-4 print:bg-cobalt-700">
            <h2 className="text-xl font-bold text-white">Section Scores</h2>
          </div>
          
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-nickel-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-nickel-500 uppercase tracking-wider">
                      Section
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-nickel-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-nickel-500 uppercase tracking-wider">
                      Rating
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-nickel-500 uppercase tracking-wider">
                      Version
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nickel-200">
                  {displayMode === 'single' ? (
                    // Single mode - show selected versions
                    sections && sections.length > 0 ? (
                      getSortedSections(sections).map((section) => {
                        console.log('Rendering section:', section);
                        const score = section?.ai_review_json?.score || 0;
                        const maxScore = 10; // Assuming each section is scored out of 10
                        const scoreColor = getScoreColor(score, maxScore);
                        const borderColor = getSectionBorderColor(score, maxScore);
                        
                        return (
                          <tr 
                            key={section.id}
                            className={`cursor-pointer hover:bg-nickel-50 ${borderColor}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center">
                                <a href={`#section-${section.id}`} className="font-medium text-cobalt-700 hover:text-cobalt-800 hover:underline">
                                  {renderSafely(section.section_title, "Untitled Section")}
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
                            <td className="px-4 py-3 text-nickel-500">
                              v{section.version || 1}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-center text-nickel-500">No reviewed sections are available. Please review at least one section.</td>
                      </tr>
                    )
                  ) : (
                    // Parallel mode - show all selected versions for comparison
                    Object.entries(groupedSections).flatMap(([title, group]) => {
                      // Get the versions to compare
                      const versionsToCompare = compareVersions[title] || 
                        (group.versions.length > 1 
                          ? [group.versions.sort((a, b) => b - a)[0], group.versions.sort((a, b) => b - a)[1]] 
                          : [group.latestVersion]);
                      
                      // Get the section objects for the selected versions
                      return versionsToCompare
                        .map(version => group[version])
                        .filter(Boolean)
                        .sort((a, b) => {
                          // Sort by title first, then by version (descending)
                          const titleCompare = SECTION_ORDER.indexOf(a.section_title) - SECTION_ORDER.indexOf(b.section_title);
                          if (titleCompare !== 0) return titleCompare;
                          return b.version - a.version;
                        })
                        .map(section => {
                          const score = section.ai_review_json?.score || 0;
                          const maxScore = 10;
                          const scoreColor = getScoreColor(score, maxScore);
                          const borderColor = getSectionBorderColor(score, maxScore);
                          
                          return (
                            <tr 
                              key={section.id}
                              className={`cursor-pointer hover:bg-nickel-50 ${borderColor}`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center">
                                  <a href={`#section-${title}`} className="font-medium text-cobalt-700 hover:text-cobalt-800 hover:underline">
                                    {renderSafely(title, "Untitled Section")}
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
                              <td className="px-4 py-3 text-nickel-500">
                                v{section.version || 1}
                              </td>
                            </tr>
                          );
                        });
                    })
                  )}
                </tbody>
                <tfoot className="bg-nickel-50">
                  <tr>
                    <td className="px-4 py-3 font-medium">Overall</td>
                    <td className="px-4 py-3 font-medium text-purple-700">
                      {scores.totalScore.toFixed(1)}/{scores.maxPossibleScore}
                    </td>
                    <td className="px-4 py-3">
                      {getStarRating(scores.overallPercentage / 20)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {scores.overallPercentage.toFixed(1)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Individual Section Reviews */}
        {displayMode === 'single' ? (
          // Single version display
          sections && sections.length > 0 ? (
            getSortedSections(sections).map((section) => {
              console.log('Rendering section:', section);
              const score = section?.ai_review_json?.score || 0;
              const maxScore = 10; // Assuming each section is scored out of 10
              const borderColor = getSectionBorderColor(score, maxScore);

              return (
                <div 
                  id={`section-${section.id}`}
                  key={section.id}
                  className={`nk-panel overflow-hidden mb-8 print:shadow-none border-l-4 ${borderColor} print:break-before-page`}
                >
                  <div className="bg-nickel-800 px-6 py-4 print:bg-nickel-800">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-white">{renderSafely(section.section_title, "Untitled Section")}</h2>
                      <div className="flex items-center">
                        <div className={`font-semibold text-white px-3 py-1 rounded-full bg-opacity-80 ${getScoreColor(score, maxScore).replace('text-', 'bg-')}`}>
                          Score: {score.toFixed(1)}/{maxScore}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    {/* Section content */}
                    <div className="mb-6">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-lg font-medium text-nickel-900">Section Content</h3>
                        <span className="text-sm text-nickel-500">Version {section.version || 1}</span>
                      </div>
                      
                      <div 
                        className={`border ${borderColor} p-4 rounded-md overflow-hidden relative ${expandedSections[section.id] ? '' : 'max-h-32'}`}
                        style={{ transition: 'max-height 0.3s ease-in-out' }}
                      >
                        {!expandedSections[section.id] && (
                          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent"></div>
                        )}
                        <div className="text-nickel-800 whitespace-pre-line">{renderSafely(section.user_input)}</div>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSectionExpand(section.id);
                        }}
                        className="text-sm text-cobalt-700 hover:text-cobalt-800 mt-2"
                      >
                        {expandedSections[section.id] ? 'Show Less' : 'Show More'}
                      </button>
                    </div>
                    
                    {/* Summary */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-nickel-900 mb-2">Summary</h3>
                      <div className="bg-nickel-50 p-4 rounded-md">
                        <p className="text-nickel-700">{section.ai_review_json?.summary}</p>
                      </div>
                    </div>
                    
                    {/* Strengths */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mr-2">
                          <FaCheck className="text-white text-xs" />
                        </div>
                        Strengths
                      </h3>
                      <div className="bg-green-50 p-4 rounded-md">
                        <ul className="space-y-1">
                          {section.ai_review_json?.strengths.map((strength, idx) => (
                            <li key={idx} className="flex">
                              <span className="text-green-500 mr-2">•</span>
                              <span className="text-nickel-700">
                                {renderSafely(strength)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Weaknesses */}
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
                        <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center mr-2">
                          <FaTimes className="text-white text-xs" />
                        </div>
                        Weaknesses
                      </h3>
                      <div className="bg-red-50 p-4 rounded-md">
                        <ul className="space-y-1">
                          {section.ai_review_json?.weaknesses.map((weakness, idx) => (
                            <li key={idx} className="flex">
                              <span className="text-red-500 mr-2">•</span>
                              <span className="text-nickel-700">
                                {renderSafely(weakness)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Recommendations or Suggestions */}
                    <div>
                      <h3 className="text-lg font-medium text-nickel-900 mb-2 flex items-center">
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
                              <span className="text-nickel-700">
                                {renderSafely(rec)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Back to Top link */}
                    <div className="mt-6 text-right">
                      <a 
                        href="#top" 
                        className="inline-flex items-center text-cobalt-700 hover:text-cobalt-800"
                      >
                        <span className="mr-1">Back to Top</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            // Fallback when no sections are available
            <div className="nk-panel overflow-hidden mb-8">
              <div className="p-8 text-center">
                <div className="text-amber-500 mb-4">
                  <FaExclamationTriangle className="inline-block h-12 w-12" />
                </div>
                <h3 className="text-xl font-medium text-nickel-900 mb-2">No Reviewed Sections Available</h3>
                <p className="text-nickel-600 mb-4">
                  Please review at least one section before viewing the final review details.
                </p>
                <Link
                  href={`/reviewer/${id}`}
                  className="inline-flex items-center px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 transition-colors"
                >
                  <FaArrowLeft className="mr-2" /> Go Back to Reviewer Dashboard
                </Link>
              </div>
            </div>
          )
        ) : (
          // Parallel comparison display
            Object.entries(groupedSections)
              .sort(([titleA], [titleB]) => {
                const aIndex = SECTION_ORDER.indexOf(titleA);
                const bIndex = SECTION_ORDER.indexOf(titleB);
                
                if (aIndex === -1 && bIndex === -1) {
                  return titleA.localeCompare(titleB);
                }
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                
                return aIndex - bIndex;
              })
              .map(([title, group]) => {
                // Get the versions to compare
                const versionsToCompare = compareVersions[title] || 
                  (group.versions.length > 1 
                    ? [group.versions.sort((a, b) => b - a)[0], group.versions.sort((a, b) => b - a)[1]] 
                    : [group.latestVersion]);
                
                // Get the section objects for the selected versions
                const sectionVersions = versionsToCompare
                  .map(version => group[version])
                  .filter(Boolean)
                  .sort((a, b) => b.version - a.version); // Latest version first
                
                if (sectionVersions.length === 0) return null;
                
                return (
                  <div 
                    key={title}
                    id={`section-${title}`}
                    className="nk-panel overflow-hidden mb-8 print:shadow-none print:break-before-page"
                  >
                    <div className="bg-nickel-800 px-6 py-4 print:bg-nickel-800">
                      <h2 className="text-xl font-bold text-white">{renderSafely(title, "Untitled Section")}</h2>
                    </div>
                    
                    <div className="p-6">
                      {/* Version comparison grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {sectionVersions.map(section => {
                          const score = section.ai_review_json?.score || 0;
                          const maxScore = 10;
                          const borderColor = getSectionBorderColor(score, maxScore);
                          
                          return (
                            <div 
                              key={section.id}
                              className={`border-l-4 ${borderColor} rounded-md overflow-hidden`}
                            >
                              <div className="bg-nickel-100 px-4 py-2 flex justify-between items-center">
                                <h3 className="font-medium">Version {section.version}</h3>
                                <div className={`font-semibold ${getScoreColor(score, maxScore)}`}>
                                  Score: {score.toFixed(1)}/{maxScore}
                                </div>
                              </div>
                              
                              {/* Section content */}
                              <div className="p-4 border-b">
                                <h4 className="font-medium text-nickel-700 mb-2">Content</h4>
                                <div 
                                  className={`border border-nickel-200 p-3 rounded-md overflow-hidden relative ${
                                    expandedSections[section.id] ? '' : 'max-h-32'
                                  }`}
                                >
                                  {!expandedSections[section.id] && (
                                    <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent"></div>
                                  )}
                                  <p className="text-nickel-800 whitespace-pre-line text-sm">{section.user_input}</p>
                                </div>
                                
                                <button
                                  onClick={() => toggleSectionExpand(section.id)}
                                  className="text-xs text-cobalt-700 hover:text-cobalt-800 mt-2"
                                >
                                  {expandedSections[section.id] ? 'Show Less' : 'Show More'}
                                </button>
                              </div>
                              
                              {/* Review summary */}
                              <div className="p-4 border-b">
                                <h4 className="font-medium text-nickel-700 mb-2">Summary</h4>
                                <p className="text-sm text-nickel-600">{section.ai_review_json?.summary}</p>
                              </div>
                              
                              {/* Strengths */}
                              <div className="p-4 border-b">
                                <h4 className="font-medium text-nickel-700 mb-2 flex items-center">
                                  <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center mr-2">
                                    <FaCheck className="text-white text-xs" />
                                  </div>
                                  Strengths
                                </h4>
                                <ul className="space-y-1 text-sm">
                                  {section.ai_review_json?.strengths.map((strength, idx) => (
                                    <li key={idx} className="flex">
                                      <span className="text-green-500 mr-2">•</span>
                                      <span className="text-nickel-700">
                                        {renderSafely(strength)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              
                              {/* Weaknesses */}
                              <div className="p-4 border-b">
                                <h4 className="font-medium text-nickel-700 mb-2 flex items-center">
                                  <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center mr-2">
                                    <FaTimes className="text-white text-xs" />
                                  </div>
                                  Weaknesses
                                </h4>
                                <ul className="space-y-1 text-sm">
                                  {section.ai_review_json?.weaknesses.map((weakness, idx) => (
                                    <li key={idx} className="flex">
                                      <span className="text-red-500 mr-2">•</span>
                                      <span className="text-nickel-700">
                                        {renderSafely(weakness)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              
                              {/* Recommendations */}
                              <div className="p-4">
                                <h4 className="font-medium text-nickel-700 mb-2 flex items-center">
                                  <div className="w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center mr-2">
                                    <span className="text-white text-xs font-bold">!</span>
                                  </div>
                                  Recommendations
                                </h4>
                                <ul className="space-y-1 text-sm">
                                  {(section.ai_review_json?.suggestions || section.ai_review_json?.recommendations || []).map((rec, idx) => (
                                    <li key={idx} className="flex">
                                      <span className="text-amber-500 mr-2">→</span>
                                      <span className="text-nickel-700">
                                        {renderSafely(rec)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Back to Top link */}
                      <div className="mt-6 text-right">
                        <a 
                          href="#top" 
                          className="inline-flex items-center text-cobalt-700 hover:text-cobalt-800"
                        >
                          <span className="mr-1">Back to Top</span>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })
        )}
      </div>

      {/* Print-only footer */}
      <div className="hidden p-4 text-center text-[12px] text-nickel-500 print:block">
        <p>Generated by GrantGenie AI | {new Date().toLocaleDateString()}</p>
      </div>
      </div>
    </ReviewerShell>
  );
}
