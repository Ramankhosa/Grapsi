// @ts-nocheck
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

// Define the type for the progress state
type ReviewProgressState = {
  last_reviewed_section: string;
  last_reviewed_section_id: string;
  timestamp: string;
};

// Define the type for stages
type Section = {
  id: string;
  title: string;
  href: string;
  status?: 'draft' | 'reviewed' | 'revised';
  isActive?: boolean;
  version?: number;
};

interface ReviewerSectionsNavProps {
  callId: string;
  sections: Section[];
  reviewProgressState?: ReviewProgressState | null;
  onRestartReview?: () => void;
  onResumeReview?: () => void;
}

const ReviewerSectionsNav: React.FC<ReviewerSectionsNavProps> = ({ 
  callId, 
  sections, 
  reviewProgressState,
  onRestartReview,
  onResumeReview
}) => {
  const router = useRouter();

  // Get status class for styling
  const getStatusClass = (status: string | undefined) => {
    switch (status) {
      case 'reviewed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'revised':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <h2 className="text-lg font-semibold mb-3 text-gray-800">Project Sections</h2>
      
      {reviewProgressState && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md">
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Review in progress</p>
            <p>Last reviewed: {reviewProgressState.last_reviewed_section}</p>
            <p className="text-xs text-blue-700">
              {new Date(reviewProgressState.timestamp).toLocaleString()}
            </p>
            <div className="mt-2 flex space-x-2">
              <button 
                onClick={onResumeReview}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
              >
                Resume
              </button>
              <button 
                onClick={onRestartReview}
                className="px-3 py-1 bg-white border border-blue-200 text-blue-700 text-sm rounded hover:bg-blue-50 transition-colors"
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="space-y-1">
        {sections.map((section) => (
          <Link
            key={section.id}
            href={section.href}
            className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
              section.isActive
                ? 'bg-green-600 text-white'
                : 'hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center">
              <span className="font-medium">{section.title}</span>
              {section.version && section.version > 1 && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  v{section.version}
                </span>
              )}
            </div>
            {section.status && (
              <span className={`text-xs px-2 py-1 rounded-full ${getStatusClass(section.status)}`}>
                {section.status.charAt(0).toUpperCase() + section.status.slice(1)}
              </span>
            )}
          </Link>
        ))}
        
        <Link
          href={`/reviewer/${callId}/section/new?new=true`}
          className={`flex items-center justify-center mt-3 p-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors`}
        >
          Add New Section
        </Link>
      </div>
    </div>
  );
};

export default ReviewerSectionsNav; 