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
  reviewerMode?: string;
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
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-64 w-full max-w-[900px] animate-pulse rounded-xl bg-nickel-100" />
      </div>
    );
  }

  return (
    <div className="nk-ground">
      <Head>
        <title>AI Grant Reviewer — GrantMentor</title>
        <meta name="description" content="AI-driven grant proposal review and optimization" />
      </Head>

      <header className="border-b border-nickel-200 bg-white">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <span className="nk-eyebrow">GrantMentor</span>
            <h1 className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em] text-nickel-900">
              Grant Reviewer
            </h1>
          </div>
          <Link href="/dashboard" className="nk-btn-ghost nk-btn-sm shrink-0">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-nickel-900">
              Your review workspaces
            </h2>
            <p className="nk-sub mt-1 max-w-prose">
              Each workspace holds one proposal, reviewed against one call's rules.
            </p>
          </div>
          <Link href="/reviewer/new" className="nk-btn-primary nk-btn-sm">
            <FaPlus aria-hidden="true" /> New workspace
          </Link>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-[72px] animate-pulse rounded-xl bg-nickel-100" />
            ))}
          </div>
        ) : reviewerCalls.length > 0 ? (
          <ul className="nk-panel divide-y divide-nickel-200 overflow-hidden">
            {reviewerCalls.map(call => (
              <li key={call.id} className="group relative transition-colors hover:bg-nickel-25">
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/reviewer/${call.id}`}
                      className="block truncate text-[14px] font-medium text-nickel-900 hover:text-cobalt-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                    >
                      {call.project_title}
                    </Link>
                    <p className="mt-0.5 truncate text-[12.5px] text-nickel-500">
                      {call.agency_name}
                    </p>
                  </div>

                  <span
                    className={
                      call.review_status === "parsed"
                        ? "nk-badge nk-badge-ok"
                        : call.review_status === "pending"
                          ? "nk-badge nk-badge-warn"
                          : "nk-badge nk-badge-danger"
                    }
                  >
                    {call.review_status === "parsed"
                      ? "Ready"
                      : call.review_status === "pending"
                        ? "Pending"
                        : "Failed"}
                  </span>

                  <span className="nk-mono hidden shrink-0 text-nickel-500 sm:inline">
                    {new Date(call.created_at).toLocaleDateString()}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={e => handleEdit(call.id, e)}
                      className="nk-btn-ghost nk-btn-xs"
                      aria-label={`Open ${call.project_title}`}
                    >
                      <FaEdit aria-hidden="true" />
                    </button>
                    <button
                      onClick={e => handleDelete(call.id, e)}
                      disabled={isDeleting === call.id}
                      className="nk-btn-ghost nk-btn-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Delete ${call.project_title}`}
                    >
                      {isDeleting === call.id ? (
                        <FaSpinner className="animate-spin" aria-hidden="true" />
                      ) : (
                        <FaTrash aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="nk-panel p-12 text-center">
            <span className="nk-tile mx-auto mb-4 h-12 w-12">
              <FaFileAlt aria-hidden="true" />
            </span>
            <h3 className="nk-title">No workspaces yet</h3>
            <p className="nk-sub mx-auto mt-2 max-w-prose">
              Start from a funding call in the library, or paste the call's own URL and
              its terms and reviewer rules will be pulled out for you.
            </p>
            <Link href="/reviewer/new" className="nk-btn-primary nk-btn-sm mt-6">
              <FaPlus aria-hidden="true" /> New workspace
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
