// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import { toast } from "react-hot-toast";
import RichTextEditor from "../../../../components/RichTextEditor";
import BudgetJustificationEditor from "../../../../components/BudgetJustificationEditor";
import ContextSummaryView from "../../../../components/ContextSummaryView";
import ReviewerSectionAssetsPanel from "../../../../components/ReviewerSectionAssetsPanel";
import { ReviewerProse, ReviewerText } from "@/components/reviewer/ReviewerText";
import ReviewerRulesPanel from "@/components/reviewer/ReviewerRulesPanel";
import ReviewerShell from "@/components/reviewer/ReviewerShell";
import RevisionComposer from "@/components/reviewer/RevisionComposer";
import ScoreBar from "@/components/reviewer/ScoreBar";

const ADDRESSED = {
  addressed: { className: "nk-badge nk-badge-ok", label: "Addressed" },
  partially: { className: "nk-badge nk-badge-warn", label: "Partly addressed" },
  not_addressed: { className: "nk-badge nk-badge-danger", label: "Not addressed" },
};

// Reviewer output is text, not markup.
const renderSafely = (content, fallback = "") => (
  <ReviewerText value={content} fallback={fallback} />
);

/** Model output is not guaranteed to be an array even after its own defaults. */
const asList = value => (Array.isArray(value) ? value.filter(Boolean) : []);

function Disclosure({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="nk-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-nickel-25"
      >
        <span className="text-[13px] font-semibold text-nickel-900">{title}</span>
        <span className="flex items-center gap-2">
          {typeof count === "number" && <span className="nk-mono text-nickel-500">{count}</span>}
          <span className="nk-mono text-nickel-400">{open ? "Hide" : "Show"}</span>
        </span>
      </button>
      {open && <div className="border-t border-nickel-200 p-4">{children}</div>}
    </div>
  );
}

function ReviewList({ title, items, tone = "neutral", emptyText }) {
  const list = asList(items);
  const accent = {
    good: "border-l-emerald-500",
    bad: "border-l-red-500",
    act: "border-l-amber-500",
    neutral: "border-l-nickel-300",
  }[tone];

  return (
    <div>
      <h3 className="nk-eyebrow">{title}</h3>
      {list.length > 0 ? (
        <ul className={`mt-2 space-y-2 border-l-2 pl-3 ${accent}`}>
          {list.map((item, idx) => (
            <li key={idx} className="text-[13px] leading-5 text-nickel-700">
              {renderSafely(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-nickel-500">{emptyText}</p>
      )}
    </div>
  );
}

export default function SectionDetail() {
  const { status } = useSession();
  const router = useRouter();
  const { id: callId, sectionId } = router.query;

  const [call, setCall] = useState(null);
  const [allSections, setAllSections] = useState([]);
  const [section, setSection] = useState(null);
  const [promptScope, setPromptScope] = useState(null);
  const [previousSection, setPreviousSection] = useState(null);
  const [priorSummaries, setPriorSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reviewBusy, setReviewBusy] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonError, setComparisonError] = useState("");

  const [mode, setMode] = useState("view"); // view | edit | revise
  const [editedContent, setEditedContent] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [router, status]);

  const loadSection = useCallback(async () => {
    if (!callId || !sectionId) return;
    const response = await axios.get(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
    const data = { ...response.data.section, user_input: response.data.section.user_input || "" };
    setSection(data);
    setPromptScope(response.data.prompt_scope || null);
    setEditedContent(data.user_input);
    setComparison(data?.ai_review_json?.revision_comparison || null);

    if (data.previous_section_id) {
      try {
        const prev = await axios.get(
          `/api/reviewer/calls/${callId}/sections/${data.previous_section_id}`
        );
        setPreviousSection(prev.data.section);
      } catch (err) {
        console.error("Error fetching previous version:", err);
        setPreviousSection(null);
      }
    } else {
      setPreviousSection(null);
    }
    return data;
  }, [callId, sectionId]);

  useEffect(() => {
    const load = async () => {
      if (!callId || !sectionId || status !== "authenticated") return;
      try {
        setLoading(true);
        setError("");
        const [callRes, sectionsRes] = await Promise.all([
          axios.get(`/api/reviewer/calls/${callId}`),
          axios.get(`/api/reviewer/calls/${callId}/sections`),
        ]);
        setCall(callRes.data.call);
        setAllSections(sectionsRes.data.sections || []);
        await loadSection();

        try {
          const summaries = await axios.get(
            `/api/reviewer/calls/${callId}/sections/${sectionId}/prior-summaries`
          );
          setPriorSummaries(summaries.data.summaries || []);
        } catch (err) {
          console.error("Error fetching prior summaries:", err);
        }
      } catch (err) {
        console.error("Error loading section:", err);
        setError("We couldn't load this section.");
        if (axios.isAxiosError(err) && [401, 404].includes(err.response?.status)) {
          router.push(`/reviewer/${callId}`);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [callId, sectionId, status, router, loadSection]);

  const refreshSections = useCallback(async () => {
    if (!callId) return;
    const res = await axios.get(`/api/reviewer/calls/${callId}/sections`);
    setAllSections(res.data.sections || []);
  }, [callId]);

  const handleReview = async () => {
    if (!section) return;
    try {
      setReviewBusy(true);
      const response = await axios.post(`/api/reviewer/calls/${callId}/sections/${sectionId}/review`);
      await loadSection();
      await refreshSections();
      toast.success(
        response?.data?.report_refreshed
          ? "Section reviewed and the panel report updated"
          : "Section reviewed"
      );
    } catch (err) {
      const status = err?.response?.status;
      toast.error(
        status === 429
          ? "The reviewer is rate limited. Try again in a minute."
          : err?.response?.data?.error || "Couldn't review this section."
      );
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!section) return;
    try {
      setSaveBusy(true);
      const response = await axios.put(`/api/reviewer/calls/${callId}/sections/${sectionId}`, {
        user_input: editedContent,
        section_title: section.section_title,
      });
      setSection(prev => ({ ...prev, ...response.data.section }));
      setMode("view");
      await refreshSections();
      toast.success(
        response.data.returned_to_draft
          ? "Saved. This section needs reviewing again."
          : "Saved"
      );
    } catch (err) {
      toast.error(err?.response?.data?.error || "Couldn't save your changes.");
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleteBusy(true);
      await axios.delete(`/api/reviewer/calls/${callId}/sections/${sectionId}`);
      router.push(`/reviewer/${callId}`);
    } catch (err) {
      toast.error("Couldn't delete this section.");
      setDeleteBusy(false);
      setConfirmDelete(false);
    }
  };

  const loadComparison = async () => {
    if (!section?.previous_section_id) return;
    try {
      setComparisonBusy(true);
      setComparisonError("");
      const response = await axios.post(
        `/api/reviewer/calls/${callId}/sections/${sectionId}/compare-revisions`
      );
      setComparison(response.data.comparison);
    } catch (err) {
      setComparisonError(
        err?.response?.data?.error || "Couldn't work out what changed between these versions."
      );
    } finally {
      setComparisonBusy(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="w-full max-w-[900px] space-y-4 px-6">
          <div className="h-16 animate-pulse rounded-xl bg-nickel-100" />
          <div className="h-80 animate-pulse rounded-xl bg-nickel-100" />
        </div>
      </div>
    );
  }

  if (error || !section) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center px-6">
        <div className="nk-panel max-w-md p-6 text-center">
          <h2 className="nk-title">{error ? "Something went wrong" : "Section not found"}</h2>
          <p className="nk-sub mt-2">
            {error || "This section may have been deleted."}
          </p>
          <Link href={`/reviewer/${callId}`} className="nk-btn-primary nk-btn-sm mt-5">
            Back to the workspace
          </Link>
        </div>
      </div>
    );
  }

  const review = section.ai_review_json || {};
  const hasReview = section.status === "reviewed" && Object.keys(review).length > 0;
  const isStale = Boolean(section.sourceStale) && Object.keys(review).length > 0;
  const isBudget = section.section_title.toLowerCase().includes("budget");
  const supportsAssets = ["method", "timeline", "budget"].some(k =>
    section.section_title.toLowerCase().includes(k)
  );
  // `improvement_flag` is null when no comparison was possible. The old panel
  // read null as failure and printed a red "Not improved" for first reviews.
  const improvement = section.improvement_flag;

  const addressedPoints = asList(comparison?.addressed_points);
  const tally = comparison?.addressed_summary;

  return (
    <ReviewerShell
      call={call || { id: callId }}
      sections={allSections}
      activeSectionId={sectionId}
      eyebrow={`v${section.version || 1}`}
      title={section.section_title}
      actions={
        mode === "view" && (
          <div className="flex items-center gap-2">
            {section.status === "draft" && (
              <button
                type="button"
                onClick={handleReview}
                disabled={reviewBusy}
                className="nk-btn-primary nk-btn-sm"
              >
                {reviewBusy ? "Reviewing…" : isStale ? "Re-review" : "Run review"}
              </button>
            )}
            {hasReview && (
              <button type="button" onClick={() => setMode("revise")} className="nk-btn-primary nk-btn-sm">
                Revise
              </button>
            )}
          </div>
        )
      }
    >
      {mode === "revise" ? (
        <RevisionComposer
          callId={callId}
          section={section}
          onCancel={() => setMode("view")}
          onComplete={async newSectionId => {
            await refreshSections();
            setMode("view");
            router.push(`/reviewer/${callId}/section/${newSectionId}`);
          }}
        />
      ) : (
        <div className="space-y-5">
          {isStale && (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900"
            >
              This section was edited after it was reviewed, so the remarks below describe
              an earlier draft. Run the review again to score what is here now.
            </div>
          )}

          <ReviewerRulesPanel
            scope={promptScope}
            sectionTitle={section.section_title}
            callRulesHref={`/reviewer/${callId}/call-analysis`}
            defaultOpen={section.status === "draft"}
          />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* Draft */}
            <div className="nk-panel min-w-0">
              <div className="nk-panel-head">
                <div>
                  <h2 className="nk-title">Your draft</h2>
                  <p className="nk-sub mt-0.5">
                    Version {section.version || 1}
                    {section.is_revision && previousSection
                      ? ` · revised from v${previousSection.version}`
                      : ""}
                  </p>
                </div>
                {mode === "view" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("edit")}
                      className="nk-btn-secondary nk-btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="nk-btn-danger nk-btn-sm"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditedContent(section.user_input);
                        setMode("view");
                      }}
                      disabled={saveBusy}
                      className="nk-btn-secondary nk-btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={saveBusy}
                      className="nk-btn-primary nk-btn-sm"
                    >
                      {saveBusy ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
              </div>

              <div className="p-5">
                {mode === "edit" && hasReview && (
                  <p className="mb-3 rounded-md border border-nickel-200 bg-nickel-50 px-3 py-2 text-[12.5px] leading-4 text-nickel-600">
                    Editing a reviewed section returns it to draft — the score no longer
                    applies until you review it again. To keep this version and score a new
                    one, use <span className="font-medium">Revise</span> instead.
                  </p>
                )}
                {isBudget ? (
                  <BudgetJustificationEditor
                    value={mode === "edit" ? editedContent : section.user_input}
                    onChange={setEditedContent}
                    readOnly={mode !== "edit"}
                  />
                ) : (
                  <RichTextEditor
                    value={mode === "edit" ? editedContent : section.user_input}
                    onChange={setEditedContent}
                    readOnly={mode !== "edit"}
                  />
                )}

                {supportsAssets && (
                  <div className="mt-6 border-t border-nickel-200 pt-5">
                    <h3 className="nk-eyebrow mb-2">Attachments</h3>
                    <ReviewerSectionAssetsPanel
                      reviewVersionId={section.id}
                      projectId={section.call_id}
                      sectionType={
                        section.section_title.toLowerCase().includes("method")
                          ? "METHODOLOGY"
                          : section.section_title.toLowerCase().includes("timeline")
                            ? "TIMELINE"
                            : "BUDGET_JUSTIFICATION"
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Review */}
            <div className="min-w-0 space-y-5">
              {hasReview ? (
                <div className="nk-panel">
                  <div className="nk-panel-head">
                    <h2 className="nk-title">Review</h2>
                    {section.is_revision && (
                      <span
                        className={
                          improvement === null || improvement === undefined
                            ? "nk-badge"
                            : improvement
                              ? "nk-badge nk-badge-ok"
                              : "nk-badge nk-badge-warn"
                        }
                      >
                        {improvement === null || improvement === undefined
                          ? "Not assessed"
                          : improvement
                            ? "Improved"
                            : "No real gain"}
                      </span>
                    )}
                  </div>

                  <div className="space-y-5 p-5">
                    <ScoreBar
                      score={review.score}
                      delta={typeof review.score_delta === "number" ? review.score_delta : null}
                      comparedToVersion={review.revision_of_version ?? null}
                    />

                    <div>
                      <h3 className="nk-eyebrow">Summary</h3>
                      <ReviewerProse
                        value={review.summary}
                        fallback="No summary was recorded."
                        className="mt-2 text-[13px] leading-5 text-nickel-700"
                      />
                    </div>

                    <ReviewList
                      title="Strengths"
                      items={review.strengths}
                      tone="good"
                      emptyText="No specific strengths were highlighted."
                    />
                    <ReviewList
                      title="Weaknesses"
                      items={review.weaknesses}
                      tone="bad"
                      emptyText="No specific weaknesses were raised."
                    />
                    <ReviewList
                      title="Recommendations"
                      items={
                        asList(review.recommendations).length
                          ? review.recommendations
                          : review.suggestions
                      }
                      tone="act"
                      emptyText="No recommendations were given."
                    />

                    {asList(review.non_scoring_reminders).length > 0 && (
                      <ReviewList
                        title="Submission reminders"
                        items={review.non_scoring_reminders}
                        emptyText=""
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="nk-panel p-6 text-center">
                  <h2 className="nk-title">Not reviewed yet</h2>
                  <p className="nk-sub mx-auto mt-2 max-w-[34ch]">
                    Run the review to score this draft against the call's rules.
                  </p>
                  <button
                    type="button"
                    onClick={handleReview}
                    disabled={reviewBusy}
                    className="nk-btn-primary nk-btn-sm mt-4"
                  >
                    {reviewBusy ? "Reviewing…" : "Run review"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* What changed since the previous version */}
          {previousSection && (
            <section className="nk-panel">
              <div className="nk-panel-head">
                <div>
                  <h2 className="nk-title">
                    Against v{previousSection.version}
                  </h2>
                  <p className="nk-sub mt-0.5">
                    {tally
                      ? `${tally.addressed} of ${tally.total} previous remarks fully addressed`
                      : "What this revision changed, and what it left open"}
                  </p>
                </div>
                {!comparison && (
                  <button
                    type="button"
                    onClick={loadComparison}
                    disabled={comparisonBusy}
                    className="nk-btn-secondary nk-btn-sm"
                  >
                    {comparisonBusy ? "Comparing…" : "Compare"}
                  </button>
                )}
              </div>

              {comparisonError && (
                <p role="alert" className="border-b border-nickel-200 px-5 py-3 text-[13px] text-red-700">
                  {comparisonError}
                </p>
              )}

              {comparison && (
                <div className="space-y-5 p-5">
                  <div>
                    <h3 className="nk-eyebrow">What changed</h3>
                    <ReviewerProse
                      value={comparison.improvement_summary}
                      fallback="No summary of the changes was recorded."
                      className="mt-2 max-w-prose text-[13px] leading-5 text-nickel-700"
                    />
                  </div>

                  {addressedPoints.length > 0 && (
                    <div>
                      <h3 className="nk-eyebrow">Every point the last review raised</h3>
                      <ul className="mt-2 space-y-2">
                        {addressedPoints.map((point, index) => {
                          const badge = ADDRESSED[point.status] || {
                            className: "nk-badge",
                            label: point.status || "Unknown",
                          };
                          return (
                            <li
                              key={index}
                              className="rounded-lg border border-nickel-200 bg-nickel-25 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <span className="min-w-0 flex-1 text-[13px] leading-5 text-nickel-900">
                                  {renderSafely(point.point)}
                                </span>
                                <span className={`${badge.className} shrink-0`}>{badge.label}</span>
                              </div>
                              {point.evidence && (
                                <p className="mt-1.5 text-[12.5px] leading-5 text-nickel-500">
                                  {renderSafely(point.evidence)}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="grid gap-5 md:grid-cols-2">
                    <ReviewList
                      title="Key changes"
                      items={comparison.key_changes}
                      emptyText="No specific changes were listed."
                    />
                    <ReviewList
                      title="Still open"
                      items={comparison.remaining_issues}
                      tone="bad"
                      emptyText="Nothing was left outstanding."
                    />
                  </div>

                  {asList(comparison.further_recommendations).length > 0 && (
                    <ReviewList
                      title="Next steps"
                      items={comparison.further_recommendations}
                      tone="act"
                      emptyText=""
                    />
                  )}

                  <details className="rounded-lg border border-nickel-200 bg-nickel-25 p-4">
                    <summary className="cursor-pointer text-[13px] font-medium text-nickel-700">
                      Read v{previousSection.version} side by side
                    </summary>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="nk-eyebrow mb-2">v{previousSection.version}</h4>
                        <div className="max-h-72 overflow-y-auto rounded-lg border border-nickel-200 bg-white p-3">
                          <RichTextEditor
                            value={previousSection.user_input || ""}
                            onChange={() => {}}
                            readOnly
                          />
                        </div>
                      </div>
                      <div>
                        <h4 className="nk-eyebrow mb-2">v{section.version} (this one)</h4>
                        <div className="max-h-72 overflow-y-auto rounded-lg border border-nickel-200 bg-white p-3">
                          <RichTextEditor value={section.user_input || ""} onChange={() => {}} readOnly />
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </section>
          )}

          {priorSummaries.length > 0 && (
            <Disclosure title="Context from other sections" count={priorSummaries.length}>
              <ContextSummaryView summaries={priorSummaries} />
            </Disclosure>
          )}
        </div>
      )}

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-heading"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => setConfirmDelete(false)}
            className="absolute inset-0 bg-nickel-950/45"
          />
          <div className="nk-panel relative w-full max-w-md p-6">
            <h3 id="delete-heading" className="nk-title">
              Delete v{section.version} of {section.section_title}?
            </h3>
            <p className="nk-sub mt-2">
              This removes only this version. It can't be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteBusy}
                className="nk-btn-secondary nk-btn-sm"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteBusy}
                className="nk-btn-danger nk-btn-sm"
              >
                {deleteBusy ? "Deleting…" : "Delete version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ReviewerShell>
  );
}
