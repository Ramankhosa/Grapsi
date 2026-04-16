'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { FileText, Download, Calendar, FolderOpen, Search, Eye } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

interface NoveltySearchHistoryItem {
  id: string;
  title: string;
  inventionDescription: string;
  status: string;
  currentStage: string;
  createdAt: string;
  completedAt: string | null;
  project: {
    id: string;
    name: string;
  } | null;
  patent: {
    id: string;
    title: string;
  } | null;
  hasReport: boolean;
  reportUrl: string | null;
  results: {
    stage0: any;
    stage1: { patentCount: number } | null;
    stage35: { assessmentCount: number } | null;
    stage4: any;
  };
}

interface NoveltySearchHistoryProps {
  projectId?: string; // Optional: filter by project
  showStats?: boolean; // Show user statistics
}

export default function NoveltySearchHistory({ projectId, showStats = true }: NoveltySearchHistoryProps) {
  const [history, setHistory] = useState<NoveltySearchHistoryItem[]>([]);
  const [userStats, setUserStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      if (!token) {
        setError('Authentication required');
        return;
      }

      const url = projectId
        ? `/api/novelty-search/history?projectId=${projectId}`
        : '/api/novelty-search/history';

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch search history');
      }

      const data = await response.json();
      setHistory(data.history || []);
      setUserStats(data.userStats || null);

    } catch (err) {
      console.error('Error fetching novelty search history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const downloadReport = async (searchId: string, reportUrl: string) => {
    try {
      // For now, just redirect to the report URL
      window.open(reportUrl, '_blank');
    } catch (err) {
      console.error('Error downloading report:', err);
    }
  };

  const getStatusBadge = (status: string, currentStage: string) => {
    const statusColors = {
      COMPLETED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
      PENDING: 'bg-yellow-100 text-yellow-800',
      STAGE_0_COMPLETED: 'bg-blue-100 text-blue-800',
      STAGE_1_COMPLETED: 'bg-blue-100 text-blue-800',
      STAGE_3_5_COMPLETED: 'bg-purple-100 text-purple-800'
    };

    const color = statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800';

    return (
      <Badge className={`${color} border-0`}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Novelty Search History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2">Loading search history...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Novelty Search History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-red-600">
            <p>Error: {error}</p>
            <Button onClick={fetchHistory} variant="outline" className="mt-2">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {showStats && userStats && (
        <Card>
          <CardHeader>
            <CardTitle>Search Statistics</CardTitle>
            <CardDescription>Your novelty search activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{userStats.totalSearches}</div>
                <div className="text-sm text-gray-600">Total Searches</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{history.length}</div>
                <div className="text-sm text-gray-600">Advanced Searches</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {history.filter(h => h.status === 'COMPLETED' || h.status === 'STAGE_3_5_COMPLETED').length}
                </div>
                <div className="text-sm text-gray-600">Reports Available</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Novelty Search History
            {projectId && <span className="text-sm font-normal">- Project Specific</span>}
          </CardTitle>
          <CardDescription>
            {projectId
              ? 'Searches performed within this project'
              : 'Your novelty searches with available reports'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No search history found</p>
              <p className="text-sm">
                {projectId
                  ? 'No novelty searches have been completed in this project yet.'
                  : 'You haven\'t completed any novelty searches yet.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((search, index) => (
                <div key={search.id}>
                  <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium text-gray-900 truncate">{search.title}</h3>
                        {getStatusBadge(search.status, search.currentStage)}
                      </div>

                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {search.inventionDescription}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(search.createdAt), 'MMM dd, yyyy')}
                        </div>

                        {search.project && (
                          <div className="flex items-center gap-1">
                            <FolderOpen className="h-3 w-3" />
                            {search.project.name}
                          </div>
                        )}

                        {search.results.stage1 && (
                          <div className="flex items-center gap-1">
                            <Search className="h-3 w-3" />
                            {search.results.stage1.patentCount} patents found
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {(search.status === 'COMPLETED' || search.status === 'STAGE_3_5_COMPLETED') && (
                        <>
                          <Link href={`/novelty-search/${search.id}/report`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex items-center gap-1"
                            >
                              <FileText className="h-3 w-3" />
                              View Step-by-Step
                            </Button>
                          </Link>

                          <Link href={`/novelty-search/${search.id}/consolidated`}>
                          <Button
                            size="sm"
                            variant="default"
                            className="flex items-center gap-1"
                          >
                            <Eye className="h-3 w-3" />
                              Consolidated Report
                          </Button>
                        </Link>
                        </>
                      )}

                      {search.hasReport && search.reportUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadReport(search.id, search.reportUrl!)}
                          className="flex items-center gap-1"
                        >
                          <Download className="h-3 w-3" />
                          Download PDF
                        </Button>
                      )}

                      {search.completedAt && (
                        <div className="text-xs text-green-600 font-medium">
                          Completed {format(new Date(search.completedAt), 'MMM dd')}
                        </div>
                      )}
                    </div>
                  </div>

                  {index < history.length - 1 && <div className="border-t border-gray-200 my-4" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
