// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaFileAlt, FaPlus, FaArrowLeft, FaSpinner, FaEdit, FaTrash } from "react-icons/fa";

type ReviewerCall = {
  id: string;
  project_title: string;
  agency_name: string;
  review_status: string;
  created_at: string;
};

export default function ReviewerDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reviewerCalls, setReviewerCalls] = useState<ReviewerCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Fetch reviewer calls
  useEffect(() => {
    const fetchReviewerCalls = async () => {
      if (status !== "authenticated") return;

      try {
        setLoading(true);
        const response = await axios.get("/api/reviewer/calls", {
          withCredentials: true,
        });
        setReviewerCalls(response.data.calls);
      } catch (err) {
        console.error("Error fetching reviewer calls:", err);
        setError("Failed to load reviewer data. Please try again.");
        
        // If unauthorized, redirect to login
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          router.push("/login");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchReviewerCalls();
  }, [status, router]);

  // Handle delete project
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (window.confirm("Are you sure you want to delete this project? This action cannot be undone.")) {
      try {
        setIsDeleting(id);
        await axios.delete(`/api/reviewer/calls/${id}`);
        setReviewerCalls(reviewerCalls.filter(call => call.id !== id));
      } catch (err) {
        console.error("Error deleting project:", err);
        setError("Failed to delete project. Please try again.");
      } finally {
        setIsDeleting(null);
      }
    }
  };

  // Handle edit project
  const handleEdit = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/reviewer/${id}`);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>AI Grant Reviewer - GrantGenie</title>
        <meta
          name="description"
          content="AI-driven grant proposal review and optimization"
        />
      </Head>

      {/* Header */}
      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">AI Grant Reviewer</h1>
              <p className="mt-1 text-green-100">
                AI-powered grant application analysis and feedback
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link 
                href="/app-selector"
                className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
              >
                App Selector
              </Link>
              <Link 
                href="/dashboard"
                className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
              >
                GrantMentor Dashboard
              </Link>
              <Link 
                href="/"
                className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
              >
                <FaArrowLeft className="mr-2" />
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow-md rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-gray-50 p-4 rounded-md">
              <div className="flex items-center mb-2">
                <div className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-2">1</div>
                <h3 className="font-medium">Analyze the Call</h3>
              </div>
              <p className="text-sm text-gray-600">
                Upload or paste a funding call to extract key requirements, eligibility criteria, and evaluation metrics.
              </p>
            </div>
            <div className="bg-gray-50 p-4 rounded-md">
              <div className="flex items-center mb-2">
                <div className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-2">2</div>
                <h3 className="font-medium">Review Sections</h3>
              </div>
              <p className="text-sm text-gray-600">
                Submit individual proposal sections for AI feedback on alignment with funding requirements.
              </p>
            </div>
            <div className="bg-gray-50 p-4 rounded-md">
              <div className="flex items-center mb-2">
                <div className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-2">3</div>
                <h3 className="font-medium">Optimize & Improve</h3>
              </div>
              <p className="text-sm text-gray-600">
                Get actionable suggestions to strengthen your application and increase funding chances.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">Your Projects</h2>
          <Link
            href="/reviewer/new"
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 flex items-center"
          >
            <FaPlus className="mr-2" /> Review New Project
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center items-center p-8">
            <FaSpinner className="animate-spin h-8 w-8 text-green-500" />
          </div>
        ) : reviewerCalls.length > 0 ? (
          <div className="bg-white shadow overflow-hidden rounded-md">
            <ul className="divide-y divide-gray-200">
              {reviewerCalls.map((call) => (
                <li key={call.id} className="relative">
                  <Link
                    href={`/reviewer/${call.id}`}
                    className="block hover:bg-gray-50"
                  >
                    <div className="px-6 py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <FaFileAlt className="text-green-500 mr-3" />
                          <div>
                            <p className="text-lg font-medium text-gray-900">
                              {call.project_title}
                            </p>
                            <p className="text-sm text-gray-500">
                              {call.agency_name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <span 
                            className={`px-2 py-1 text-xs rounded-full ${
                              call.review_status === "parsed" 
                                ? "bg-green-100 text-green-800" 
                                : call.review_status === "pending" 
                                ? "bg-yellow-100 text-yellow-800" 
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {call.review_status === "parsed" ? "Analyzed" : 
                             call.review_status === "pending" ? "Pending" : "Failed"}
                          </span>
                          <span className="ml-4 text-sm text-gray-500">
                            {new Date(call.created_at).toLocaleDateString()}
                          </span>
                          <div className="ml-4 flex border border-gray-300 rounded">
                            <button
                              onClick={(e) => handleDelete(call.id, e)}
                              disabled={isDeleting === call.id}
                              className="px-2 py-1 text-red-600 hover:bg-red-50 border-r border-gray-300"
                              title="Delete"
                            >
                              {isDeleting === call.id ? 
                                <FaSpinner className="animate-spin" /> : 
                                <FaTrash />
                              }
                            </button>
                            <button
                              onClick={(e) => handleEdit(call.id, e)}
                              className="px-2 py-1 text-blue-600 hover:bg-blue-50"
                              title="Edit"
                            >
                              <FaEdit />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-white shadow-md rounded-lg p-8 text-center">
            <FaFileAlt className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-2 text-lg font-medium text-gray-900">No projects yet</h3>
            <p className="mt-1 text-gray-500">
              Click "Review New Project" to analyze a funding call.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
