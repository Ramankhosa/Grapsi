'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ConsolidatedNoveltyReport from '@/components/novelty-search/ConsolidatedNoveltyReport';
import { Loader2 } from 'lucide-react';

export default function ConsolidatedNoveltyReportPage() {
  const params = useParams();
  const searchId = params?.searchId as string;
  const [searchData, setSearchData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchId) return;
    const fetchSearchData = async () => {
      try {
        setIsLoading(true);
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        const response = await fetch(`/api/novelty-search/${searchId}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('Failed to fetch search data');
        const data = await response.json();
        if (data.success && data.search) {
          setSearchData(data.search);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load report');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSearchData();
  }, [searchId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error: {error}</p>
          <a href="/dashboard" className="text-blue-600 hover:underline">Return to Dashboard</a>
        </div>
      </div>
    );
  }

  if (!searchData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">No search data found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <ConsolidatedNoveltyReport
          searchId={searchId}
          searchData={searchData.results || searchData}
        />
      </div>
    </div>
  );
}

