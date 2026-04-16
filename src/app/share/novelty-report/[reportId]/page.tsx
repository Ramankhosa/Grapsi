'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ConsolidatedNoveltyReport from '@/components/novelty-search/ConsolidatedNoveltyReport';

export default function PublicNoveltyReportPage() {
  const params = useParams();
  const reportId = params?.reportId as string;

  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');

        if (!token) {
          throw new Error('Invalid or missing access token');
        }

        const response = await fetch(`/api/share/novelty-report/${reportId}?token=${token}`);
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Invalid or expired share link');
          } else if (response.status === 410) {
            throw new Error('This share link has expired');
          } else if (response.status === 404) {
            throw new Error('Report not found');
          } else {
            throw new Error('Failed to load report');
          }
        }
        const data = await response.json();
        setReportData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };

    if (reportId) {
      fetchReport();
    }
  }, [reportId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Report Not Available</h1>
          <p className="text-slate-600">{error}</p>
          <p className="text-sm text-slate-500 mt-4">This report may have expired or the link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600">No report data found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Public notice banner */}
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-blue-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-900">Shared Report</p>
              <p className="text-xs text-blue-700">This is a publicly shared novelty assessment report</p>
            </div>
          </div>
          <div className="text-xs text-blue-600">
            PatentNest.ai
          </div>
        </div>
      </div>

      <ConsolidatedNoveltyReport
        searchId={reportData.searchId}
        searchData={reportData}
      />
    </div>
  );
}
