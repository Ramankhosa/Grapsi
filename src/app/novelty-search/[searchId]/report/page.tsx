'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import NoveltySearchWorkflow from '@/components/novelty-search/NoveltySearchWorkflow';
import { PageLoadingBird } from '@/components/ui/loading-bird';

export default function NoveltySearchPipelineViewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const searchId = params?.searchId as string;

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return <PageLoadingBird message="Loading novelty search..." />;
  }

  if (!user || !searchId) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <NoveltySearchWorkflow initialSearchId={searchId} />
      </main>
    </div>
  );
}

