// @ts-nocheck
import { useState, useEffect } from 'react';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from 'next/router';
import axios from 'axios';
import Link from 'next/link';
import Head from 'next/head';
import { FaArrowLeft } from 'react-icons/fa';
import IntroductionReviewForm from '../../../components/IntroductionReviewForm';

export default function IntroductionReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { id: callId } = router.query;
  const [callData, setCallData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch call data for context
  useEffect(() => {
    if (callId && status === 'authenticated') {
      fetchCallData();
    }
  }, [callId, status]);

  const fetchCallData = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/reviewer/calls/${callId}`);
      setCallData(response.data.call);
    } catch (err: any) {
      console.error('Error fetching call data:', err);
      setError(err.response?.data?.error || 'Failed to fetch call data');
    } finally {
      setLoading(false);
    }
  };

  // Redirect to login if not authenticated
  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Introduction Review | Reviewer Module</title>
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div className="flex items-center">
              <Link href={`/reviewer/${callId}`} className="text-gray-600 hover:text-gray-900 mr-4">
                <FaArrowLeft className="inline mr-2" />
                Back to Call
              </Link>
              <h1 className="text-2xl font-bold text-gray-800">Introduction Review</h1>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
              {error}
            </div>
          )}

          {callData && (
            <div className="grid grid-cols-1 gap-6">
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 bg-green-50 border-b border-green-100">
                  <h2 className="text-lg font-semibold text-green-900">Funding Call</h2>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold">{callData.project_title}</h3>
                  <p className="text-gray-600 mt-2">{callData.agency_name}</p>
                </div>
              </div>

              <IntroductionReviewForm 
                callId={callId as string}
              />
            </div>
          )}
        </main>
      </div>
    </>
  );
} 