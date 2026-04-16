'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import Link from 'next/link';
import NoveltySearchWorkflow from '@/components/novelty-search/NoveltySearchWorkflow';
import { PageLoadingBird } from '@/components/ui/loading-bird';

// Component that uses search params, wrapped in Suspense
function NoveltySearchContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams?.get('projectId');
  const title = searchParams?.get('title');
  const description = searchParams?.get('description');
  const ideaId = searchParams?.get('ideaId');

  return (
    <NoveltySearchWorkflow 
      projectId={projectId || undefined}
      initialTitle={title || undefined}
      initialDescription={description || undefined}
      ideaId={ideaId || undefined}
    />
  );
}

export default function NoveltySearchPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Get projectId from URL for the history link (client-side only)
  const projectId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('projectId')
    : null;

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return <PageLoadingBird message="Loading novelty search..." />;
  }

  if (!user) {
    return null;
  }

  // Check if user has permission to access novelty search
  const hasPermission =
    user.roles?.includes('OWNER') ||
    user.roles?.includes('ADMIN') ||
    user.roles?.includes('MANAGER') ||
    user.roles?.includes('ANALYST');

  if (!hasPermission) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="text-red-600 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
          <p className="text-gray-600 mb-4">
            You don&apos;t have permission to access the Novelty Search feature. Please contact your administrator for
            access.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const historyHref = projectId ? `/projects/${projectId}#novelty-search-history` : '/projects';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Novelty Search</h1>
            </div>
            <div className="flex items-center space-x-3">
              <Link
                href={historyHref}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                History
              </Link>
              <div className="text-right hidden sm:block">
                <div className="text-xs text-gray-500">{user.email}</div>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-4 sm:px-6 lg:px-8">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          }
        >
          <NoveltySearchContent />
        </Suspense>
      </main>
    </div>
  );
}
