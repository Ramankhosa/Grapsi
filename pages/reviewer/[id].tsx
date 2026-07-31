// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import { toast } from "react-hot-toast";
import ReviewerShell from "@/components/reviewer/ReviewerShell";
import ReviewerProgressSpine from "@/components/reviewer/ReviewerProgressSpine";
import ScoreBar from "@/components/reviewer/ScoreBar";
import { ReviewerProse } from "@/components/reviewer/ReviewerText";
import {
  countReviewerSections,
  groupReviewerSections,
  reportFreshness,
} from "@/lib/reviewer/sectionGrouping";

const STATUS_BADGE = {
  reviewed: { className: "nk-badge nk-badge-ok", label: "Reviewed" },
  stale: { className: "nk-badge nk-badge-warn", label: "Edited" },
  draft: { className: "nk-badge", label: "Draft" },
};

export default function ReviewerCallDetail() {
  const { status } = useSession();
  const router = useRouter();
  const { id } = router.query;

  const [call, setCall] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const fetchSections = useCallback(async () => {
    if (!id) return [];
    const response = await axios.get(`/api/reviewer/calls/${id}/sections`);
    const next = response.data.sections || [];
    setSections(next);
    return next;
  }, [id]);

  useEffect(() => {
    const load = async () => {
      if (!id || status !== "authenticated") return;
      try {
        setLoading(true);
        const callResponse = await axios.get(`/api/reviewer/calls/${id}`);
        setCall(callResponse.data.call);
        await fetchSections();
      } catch (err) {
        console.error("Error fetching call details:", err);
        setError("We couldn't load this workspace.");
        if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 404)) {
          router.push("/reviewer");
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, status, router, fetchSections]);

  // Generating and regenerating are the same call. The old hub hid the button
  // once a report existed, so a report left stale by a revision could never be
  // refreshed from the page users actually land on.
  const handleGenerateReport = async () => {
    if (!id) return;
    try {
      setReportBusy(true);
      const response = await axios.post(`/api/reviewer/calls/${id}/final-review`);
      setCall(response.data.call);
      toast.success("Panel report ready");
      router.push(`/reviewer/${id}/final-review`);
    } catch (err) {
      console.error("Error generating final review:", err);
      toast.error(
        err?.response?.data?.error || "Couldn't generate the report. Review at least one section first."
      );
    } finally {
      setReportBusy(false);
    }
  };

  const handleReviewSection = async (sectionId) => {
    if (reviewingId) return;
    try {
      setReviewingId(sectionId);
      await axios.post(`/api/reviewer/calls/${id}/sections/${sectionId}/review`);
      await fetchSections();
      toast.success("Section reviewed");
    } catch (err) {
      const message = err?.response?.data?.error || "Couldn't review that section.";
      toast.error(message);
    } finally {
      setReviewingId(null);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="w-full max-w-[1100px] space-y-4 px-6">
          <div className="h-20 animate-pulse rounded-xl bg-nickel-100" />
          <div className="h-64 animate-pulse rounded-xl bg-nickel-100" />
        </div>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center px-6">
        <div className="nk-panel max-w-md p-6 text-center">
          <h2 className="nk-title">{error ? "Something went wrong" : "Workspace not found"}</h2>
          <p className="nk-sub mt-2">
            {error || "This reviewer workspace no longer exists, or you don't have access to it."}
          </p>
          <Link href="/reviewer" className="nk-btn-primary nk-btn-sm mt-5">
            Back to your workspaces
          </Link>
        </div>
      </div>
    );
  }

  const groups = groupReviewerSections(sections);
  const counts = countReviewerSections(sections);
  const freshness = reportFreshness(call.overall_review_json, sections);
  const report = call.overall_review_json;
  const unreviewed = groups.filter(group => group.status !== "reviewed");

  return (
    <ReviewerShell
      call={call}
      sections={sections}
      title="Overview"
      actions={
        <Link href={`/reviewer/${id}/edit`} className="nk-btn-ghost nk-btn-sm">
          Settings
        </Link>
      }
    >
      <div className="space-y-6">
        <ReviewerProgressSpine
          callId={id}
          sections={sections}
          overallReviewJson={report}
          onGenerateReport={handleGenerateReport}
          reportBusy={reportBusy}
        />

        {counts.total === 0 ? (
          <section className="nk-panel p-10 text-center">
            <h2 className="nk-title">Start with your proposal</h2>
            <p className="nk-sub mx-auto mt-2 max-w-prose">
              Import the whole document and it will be split into the sections this call
              requires — you can correct anything placed wrongly before it saves. Or add
              sections one at a time.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Link href={`/reviewer/${id}/import-proposal`} className="nk-btn-primary nk-btn-sm">
                Import full proposal
              </Link>
              <Link href={`/reviewer/${id}/section/new`} className="nk-btn-secondary nk-btn-sm">
                Add one section
              </Link>
            </div>
          </section>
        ) : (
          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Sections</h2>
                <p className="nk-sub mt-0.5">
                  {counts.reviewed} of {counts.total} reviewed
                  {counts.stale > 0 && ` · ${counts.stale} edited since review`}
                </p>
              </div>
              {unreviewed.length > 0 && (
                <span className="nk-badge">{unreviewed.length} awaiting review</span>
              )}
            </div>

            <ul className="divide-y divide-nickel-200">
              {groups.map(group => {
                const badge = STATUS_BADGE[group.status];
                const busy = reviewingId === group.current.id;
                return (
                  <li
                    key={group.title}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-nickel-25"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/reviewer/${id}/section/${group.current.id}`}
                        className="block truncate text-[14px] font-medium text-nickel-900 hover:text-cobalt-700"
                      >
                        {group.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={badge.className}>{badge.label}</span>
                        {group.versionCount > 1 && (
                          <span className="nk-mono text-nickel-500">
                            {group.versionCount} versions
                          </span>
                        )}
                      </div>
                    </div>

                    {group.score !== null && (
                      <span className="nk-readout-sm shrink-0 tabular-nums text-nickel-800">
                        {group.score.toFixed(1)}
                      </span>
                    )}

                    {group.status !== "reviewed" && (
                      <button
                        type="button"
                        onClick={() => handleReviewSection(group.current.id)}
                        disabled={busy || Boolean(reviewingId)}
                        className="nk-btn-secondary nk-btn-sm shrink-0"
                      >
                        {busy ? "Reviewing…" : "Review"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {report && Object.keys(report).length > 0 && (
          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Panel report</h2>
                {freshness === "stale" && (
                  <p className="mt-0.5 text-[13px] text-amber-700">
                    A section has changed since this was written.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {freshness === "stale" && (
                  <button
                    type="button"
                    onClick={handleGenerateReport}
                    disabled={reportBusy}
                    className="nk-btn-secondary nk-btn-sm"
                  >
                    {reportBusy ? "Regenerating…" : "Regenerate"}
                  </button>
                )}
                <Link href={`/reviewer/${id}/final-review`} className="nk-btn-primary nk-btn-sm">
                  Open report
                </Link>
              </div>
            </div>

            <div className="grid gap-6 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
              <ScoreBar score={report.overall_score} size="lg" label="Overall" />
              <div className="min-w-0">
                <h3 className="nk-eyebrow">Executive summary</h3>
                <ReviewerProse
                  value={report.executive_summary}
                  fallback="No executive summary was recorded."
                  className="mt-2 max-w-prose text-[13.5px] leading-6 text-nickel-700"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="nk-badge nk-badge-ok">
                    {report.major_strengths?.length || 0} strengths
                  </span>
                  <span className="nk-badge nk-badge-danger">
                    {report.major_weaknesses?.length || 0} weaknesses
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </ReviewerShell>
  );
}
