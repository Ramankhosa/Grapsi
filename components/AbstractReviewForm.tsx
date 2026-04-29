// @ts-nocheck
import React, { useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/router';
import RichTextEditor from './RichTextEditor';
import { FaSpinner } from 'react-icons/fa';

type AbstractReviewFormProps = {
  callId: string;
  onReviewComplete?: (review: any) => void;
};

export default function AbstractReviewForm({ callId, onReviewComplete }: AbstractReviewFormProps) {
  const [abstractContent, setAbstractContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [reviewData, setReviewData] = useState<any>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!abstractContent.trim()) {
      setError('Please enter abstract content');
      return;
    }
    
    try {
      setIsLoading(true);
      setError('');
      
      const response = await axios.post(`/api/reviewer/calls/${callId}/sections/abstract-review`, {
        abstractContent
      });
      
      const result = response.data;
      
      setReviewData(result.review);
      
      if (onReviewComplete) {
        onReviewComplete(result.review);
      }
      
      // Navigate to the section detail page
      router.push(`/reviewer/${callId}/section/${result.section_id}`);
    } catch (err: any) {
      console.error('Error reviewing abstract:', err);
      setError(err.response?.data?.error || 'Failed to review abstract');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">Abstract Review</h2>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Abstract Content
          </label>
          <div className="rounded-md border border-gray-300">
            <RichTextEditor
              value={abstractContent}
              onChange={setAbstractContent}
              placeholder="Enter the abstract content for review..."
            />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            The abstract should be a concise summary of the proposal, describing the problem, objectives, approach, 
            innovation, and potential impact.
          </p>
        </div>
        
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {isLoading ? (
              <>
                <FaSpinner className="animate-spin -ml-1 mr-2 h-4 w-4" />
                Processing...
              </>
            ) : (
              'Review Abstract'
            )}
          </button>
        </div>
      </form>
      
      {reviewData && (
        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-800 mb-4">Review Results</h3>
          
          {/* Score */}
          <div className="mb-6">
            <h4 className="text-md font-medium text-gray-700">Total Score</h4>
            <div className="bg-blue-50 p-4 rounded-md">
              <div className="flex items-end">
                <span className="text-3xl font-bold text-blue-700">{reviewData.section_score.toFixed(1)}</span>
                <span className="text-gray-500 ml-1">/10</span>
              </div>
            </div>
          </div>
          
          {/* Score Breakdown */}
          <div className="mb-6">
            <h4 className="text-md font-medium text-gray-700">Score Breakdown</h4>
            <div className="bg-gray-50 p-4 rounded-md">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="text-sm text-gray-600">Clarity and Conciseness</p>
                  <p className="font-medium">{reviewData.score_breakdown.clarity_and_conciseness}/2</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Problem Definition</p>
                  <p className="font-medium">{reviewData.score_breakdown.problem_definition}/2</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Objectives & Scope</p>
                  <p className="font-medium">{reviewData.score_breakdown.objectives_and_scope}/2</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Innovation & Significance</p>
                  <p className="font-medium">{reviewData.score_breakdown.innovation_and_significance}/2</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Alignment with Call</p>
                  <p className="font-medium">{reviewData.score_breakdown.alignment_with_call}/2</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="mb-6">
            <h4 className="text-md font-medium text-gray-700">Summary</h4>
            <div className="bg-gray-50 p-4 rounded-md">
              <p className="text-gray-800">{reviewData.section_summary}</p>
            </div>
          </div>
          
          {/* Strengths */}
          <div className="mb-6">
            <h4 className="text-md font-medium text-gray-700">Strengths</h4>
            <div className="bg-green-50 p-4 rounded-md">
              <ul className="list-disc pl-5 space-y-1">
                {reviewData.section_strengths.map((strength: string, index: number) => (
                  <li key={index} className="text-gray-800">{strength}</li>
                ))}
              </ul>
            </div>
          </div>
          
          {/* Weaknesses */}
          <div className="mb-6">
            <h4 className="text-md font-medium text-gray-700">Weaknesses</h4>
            <div className="bg-red-50 p-4 rounded-md">
              <ul className="list-disc pl-5 space-y-1">
                {reviewData.section_weaknesses.map((weakness: string, index: number) => (
                  <li key={index} className="text-gray-800">{weakness}</li>
                ))}
              </ul>
            </div>
          </div>
          
          {/* Suggestions */}
          <div>
            <h4 className="text-md font-medium text-gray-700">Suggestions for Improvement</h4>
            <div className="bg-yellow-50 p-4 rounded-md">
              <ul className="list-disc pl-5 space-y-1">
                {reviewData.suggestions_for_improvement.map((suggestion: string, index: number) => (
                  <li key={index} className="text-gray-800">{suggestion}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 