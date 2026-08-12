// @ts-nocheck
import { useState, useEffect } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import Head from "next/head";
import { FaFileAlt, FaPlus, FaTrash } from "react-icons/fa";

type ReviewerCall = {
  id: string;
  project_title: string;
  agency_name: string;
  reviewerMode?: string;
  review_status: string;
  created_at: string;
  progress?: { total: number; reviewed: number; stale: number };
  has_report?: boolean;
};

/**
 * Where a workspace has actually got to, phrased as the user would say it.
 *
 * The badge here used to report `review_status`, the funding-call parser's
 * state — which has read "parsed" for every workspace since the analyzer was
 * removed. A list of identical green "Ready" pills told a returning user
 * nothing about which proposal still needed work.
 */
function progressLabel(call: ReviewerCall): { text: string; className: string } {
  const progress = call.progress || { total: 0, reviewed: 0, stale: 0 };

  if (progress.total === 0) {
    return { text: "No sections yet", className: "nk-badge" };
  }
  if (progress.stale > 0) {
    return { text: `${progress.stale} edited since review`, className: "nk-badge nk-badge-warn" };
  }
  if (progress.reviewed < progress.total) {
    return {
      text: `${progress.reviewed} of ${progress.total} reviewed`,
      className: "nk-badge nk-badge-warn",
    };
  }
  if (!call.has_report) {
    return { text: "Reviewed · no report yet", className: "nk-badge" };
  }
  return { text: "Report ready", className: "nk-badge nk-badge-ok" };
}

export default function ReviewerDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reviewerCalls, setReviewerCalls] = useState<ReviewerCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  // Deleting a workspace throws away every review in it, so it asks twice —
  // inline, where the row is, rather than in a browser dialog that appears in
  // the corner of the screen detached from the thing it is about.
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }

    try {
      setIsDeleting(id);
      await axios.delete(`/api/reviewer/calls/${id}`);
      setReviewerCalls(reviewerCalls.filter(call => call.id !== id));
    } catch (err) {
      console.error("Error deleting project:", err);
      setError("Failed to delete project. Please try again.");
    } finally {
      setIsDeleting(null);
      setConfirmDelete(null);
    }
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

                  {(() => {
                    const badge = progressLabel(call);
                    return <span className={badge.className}>{badge.text}</span>;
                  })()}

                  <span className="nk-mono hidden shrink-0 text-nickel-500 sm:inline">
                    {new Date(call.created_at).toLocaleDateString()}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    {/* A pencil that navigates rather than edits reads as a
                        trap. The row title is the way in; this is the way out
                        of a workspace you no longer want. */}
                    {confirmDelete === call.id ? (
                      <>
                        <button
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setConfirmDelete(null);
                          }}
                          className="nk-btn-ghost nk-btn-xs"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={e => handleDelete(call.id, e)}
                          disabled={isDeleting === call.id}
                          className="nk-btn-xs rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700"
                        >
                          {isDeleting === call.id ? "Deleting…" : "Delete for good"}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={e => handleDelete(call.id, e)}
                        className="nk-btn-ghost nk-btn-xs text-nickel-400 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete ${call.project_title}`}
                      >
                        <FaTrash aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          // First contact with the module. Someone arriving here has no idea
          // what a "workspace" is or what they get at the end, so the empty
          // state explains the shape of the thing before asking for a click.
          <div className="nk-panel p-8 sm:p-12">
            <div className="text-center">
              <span className="nk-tile mx-auto mb-4 h-12 w-12">
                <FaFileAlt aria-hidden="true" />
              </span>
              <h3 className="nk-title">Have your proposal reviewed before the funder does</h3>
              <p className="nk-sub mx-auto mt-2 max-w-prose">
                Point it at a funding call, paste in your draft, and it scores every
                section against that call's published rules and criteria — then writes
                the panel report a committee would.
              </p>
            </div>

            <ol className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                {
                  n: 1,
                  title: "Pick the call",
                  body: "Choose one from the library, or paste its URL and the rules are extracted for you.",
                },
                {
                  n: 2,
                  title: "Add your proposal",
                  body: "Import the document once — it is split into the sections the call asks for.",
                },
                {
                  n: 3,
                  title: "Run the review",
                  body: "Section scores, a funding verdict, and a downloadable Action Taken Report.",
                },
              ].map(step => (
                <li key={step.n} className="nk-panel-quiet px-4 py-3">
                  <div className="nk-eyebrow">Step {step.n}</div>
                  <div className="mt-1 text-[13px] font-medium text-nickel-900">{step.title}</div>
                  <p className="mt-1 text-[12.5px] leading-5 text-nickel-600">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-8 text-center">
              <Link href="/reviewer/new" className="nk-btn-primary nk-btn-sm">
                <FaPlus aria-hidden="true" /> Create your first workspace
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
