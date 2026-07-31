// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import axios from 'axios';
import Link from 'next/link';
import ReviewerShell from '@/components/reviewer/ReviewerShell';
import AutoReviewPanel from '@/components/reviewer/AutoReviewPanel';
import useAutoReview, { AUTO_PHASES } from '@/components/reviewer/useAutoReview';
import { countReviewerSections } from '@/lib/reviewer/sectionGrouping';

/**
 * The dedicated run screen.
 *
 * This page used to carry its own copy of the whole pipeline — batching, rate
 * limit retries, ordering, progress accounting — around 500 lines that stopped
 * after the section reviews and never compiled the report. That orchestration
 * now lives in `useAutoReview`, shared with the workspace overview, and it runs
 * all three phases.
 */
export default function FinalReviewProcess() {
  const router = useRouter();
  const { id } = router.query;
  const { status } = useSession();

  const [call, setCall] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const fetchSections = useCallback(async () => {
    if (!id) return;
    const response = await axios.get(`/api/reviewer/calls/${id}/sections`);
    setSections(response.data.sections || []);
  }, [id]);

  useEffect(() => {
    const load = async () => {
      if (!id || status !== 'authenticated') return;
      try {
        setLoading(true);
        const [callRes] = await Promise.all([
          axios.get(`/api/reviewer/calls/${id}`),
          fetchSections(),
        ]);
        setCall(callRes.data.call);
      } catch (error) {
        console.error('Error loading workspace:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, status, fetchSections]);

  const autoRun = useAutoReview({
    callId: id,
    onSectionsChanged: fetchSections,
    onFinished: fetchSections,
  });

  // Arriving here from "Run full review" starts immediately; arriving directly
  // shows what will happen and waits for the user.
  const shouldAutoStart = router.query.start === 'true';
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (shouldAutoStart && !autoStarted && !loading && sections.length > 0) {
      setAutoStarted(true);
      autoRun.start({ rerunAll: router.query.rerun === 'true' });
    }
  }, [shouldAutoStart, autoStarted, loading, sections.length, autoRun, router.query.rerun]);

  if (status === 'loading' || loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-64 w-full max-w-[900px] animate-pulse rounded-xl bg-nickel-100" />
      </div>
    );
  }

  const counts = countReviewerSections(sections);

  return (
    <ReviewerShell call={call || { id }} sections={sections} title="Run the review">
      <div className="space-y-6">
        <AutoReviewPanel
          run={autoRun}
          onOpenReport={() => router.push(`/reviewer/${id}/final-review`)}
        />

        {autoRun.phase === 'idle' && (
          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Review the whole proposal</h2>
                <p className="nk-sub mt-0.5">
                  {counts.total === 0
                    ? 'Add some sections first.'
                    : `${counts.total} section${counts.total === 1 ? '' : 's'}, ${counts.reviewed} already reviewed`}
                </p>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <ol className="space-y-3">
                {AUTO_PHASES.map((phase, index) => (
                  <li key={phase.key} className="flex gap-3">
                    <span className="nk-tile h-6 w-6 shrink-0 text-[11px] font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-nickel-900">{phase.label}</p>
                      <p className="mt-0.5 text-[12.5px] leading-4 text-nickel-500">{phase.blurb}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="rounded-lg border border-nickel-200 bg-nickel-25 px-3.5 py-2.5 text-[12.5px] leading-4 text-nickel-600">
                It runs in this tab, so leave it open. You can stop at any point —
                whatever has already been reviewed is kept.
              </p>

              <div className="flex flex-wrap justify-end gap-2 border-t border-nickel-200 pt-4">
                <Link href={`/reviewer/${id}`} className="nk-btn-secondary nk-btn-sm">
                  Back to the workspace
                </Link>
                {counts.reviewed > 0 && (
                  <button
                    type="button"
                    onClick={() => autoRun.start({ rerunAll: true })}
                    disabled={counts.total === 0}
                    className="nk-btn-secondary nk-btn-sm"
                  >
                    Redo from scratch
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => autoRun.start({ rerunAll: false })}
                  disabled={counts.total === 0}
                  className="nk-btn-primary nk-btn-sm"
                >
                  Start
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </ReviewerShell>
  );
}
