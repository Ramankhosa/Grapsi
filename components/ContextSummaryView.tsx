// @ts-nocheck
import { useState } from 'react';

type ContextSummary = {
  section_title: string;
  context_summary: string;
  version?: number;
  last_reviewed_at?: string;
};

type ContextSummaryViewProps = {
  callId?: string;
  summaries?: ContextSummary[];
}

const ContextSummaryView: React.FC<ContextSummaryViewProps> = ({ callId, summaries = [] }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedSummaries, setFetchedSummaries] = useState<ContextSummary[]>([]);

  // Use provided summaries or fetched summaries
  const displaySummaries = summaries.length > 0 ? summaries : fetchedSummaries;

  if (loading) {
    return (
      <div className="p-4 border rounded-lg bg-white shadow-sm">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Loading context summaries...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border rounded-lg bg-white shadow-sm">
        <div className="text-red-500 text-center py-4">{error}</div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      {displaySummaries.length === 0 ? (
        <div className="text-gray-500 text-center py-4">
          No context summaries have been generated yet.
        </div>
      ) : (
        <div className="space-y-4">
          {displaySummaries.map((summary, index) => (
            <div key={index} className="border rounded p-3">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-medium text-lg">{summary.section_title} {summary.version ? `(v${summary.version})` : ''}</h3>
                {summary.last_reviewed_at && (
                  <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">
                    {new Date(summary.last_reviewed_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 p-3 rounded text-sm">
                <h4 className="font-medium mb-1 text-gray-700">Context Summary:</h4>
                <p className="whitespace-pre-wrap">{summary.context_summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContextSummaryView; 