import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';
import { FaPrint } from 'react-icons/fa';

import ReadOnlyReviewerReport, {
  type ReadOnlyCompareGroup,
} from '@/components/reviewer/report/ReadOnlyReviewerReport';

/**
 * Public, token-gated view of a shared panel report.
 *
 * This page used to be its own 900-line rendering of the report, and it had
 * drifted a long way from the one the owner sees:
 *   - it kept five fields of the report and dropped the rest — no funding
 *     verdict, no scorecards, no priority actions, no compliance, no novelty,
 *     and not one patent or funded project from the landscape;
 *   - it printed its own "overall score", an unweighted average of the section
 *     scores, instead of the panel's score — so the person a report was shared
 *     with read a different number from the person who shared it;
 *   - it rendered stored HTML with `dangerouslySetInnerHTML`, on a public URL
 *     served from the app's own origin.
 * It now renders the same read-only report as the archive and the proposal
 * desk, through `ReviewerText`, which never emits raw HTML.
 */

interface SharedCall {
  id: string;
  project_title: string;
  agency_name?: string | null;
  overall_review_json: any;
  parsed_json?: {
    report_preferences?: { displayMode?: 'single' | 'parallel' };
    agency_name?: string | null;
  } | null;
  updated_at?: string;
}

function asObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, any>) : {};
}

export default function SharedReport() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [call, setCall] = useState<SharedCall | null>(null);
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`/api/shared-report/${encodeURIComponent(token)}`);
        if (cancelled) return;
        const data = response.data || {};
        if (!data.call || !data.call.overall_review_json) {
          setError('Report not found or no longer available');
          return;
        }
        setCall({
          ...data.call,
          overall_review_json: asObject(data.call.overall_review_json),
          parsed_json: asObject(data.call.parsed_json),
        });
        setSections(Array.isArray(data.sections) ? data.sections : []);
      } catch (loadError: any) {
        if (cancelled) return;
        setError(
          loadError?.response?.status === 404
            ? 'This report is not shared, or the link has been turned off.'
            : 'The shared report could not be loaded. Try again in a moment.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const displayMode = call?.parsed_json?.report_preferences?.displayMode === 'parallel' ? 'parallel' : 'single';

  // Parallel mode is a version comparison: the API returns every reviewed
  // draft of the titles in the report, grouped here newest first.
  const compareGroups: ReadOnlyCompareGroup[] | null = useMemo(() => {
    if (displayMode !== 'parallel') return null;
    const byTitle = new Map<string, any[]>();
    for (const section of sections) {
      const title = String(section?.section_title || '').trim();
      if (!title) continue;
      byTitle.set(title, [...(byTitle.get(title) || []), section]);
    }
    return Array.from(byTitle.entries()).map(([title, versions]) => ({
      title,
      versions: [...versions].sort((a, b) => Number(b.version || 1) - Number(a.version || 1)),
    }));
  }, [displayMode, sections]);

  // Single view shows one row per title (the API already resolved them).
  const singleSections = useMemo(() => {
    if (displayMode === 'parallel') {
      return (compareGroups || []).map((group) => group.versions[0]).filter(Boolean);
    }
    return sections;
  }, [displayMode, compareGroups, sections]);

  if (loading && !error) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-cobalt-600" />
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center px-4">
        <Head>
          <title>Shared report unavailable</title>
          <meta name="robots" content="noindex" />
        </Head>
        <div className="nk-panel max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold text-nickel-900">Report unavailable</h1>
          <p className="mt-2 text-sm text-nickel-600">{error || 'Report not found or no longer available'}</p>
        </div>
      </div>
    );
  }

  const overall = call.overall_review_json || {};

  return (
    <div className="nk-ground min-h-screen">
      <Head>
        <title>{call.project_title || 'Grant proposal review'}</title>
        <meta name="description" content="Shared grant proposal review report" />
        <meta name="robots" content="noindex" />
      </Head>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 print:py-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-xs text-nickel-600">
            Shared panel report · read-only
            {displayMode === 'parallel' ? ' · version comparison' : ''}
          </p>
          <button type="button" onClick={() => window.print()} className="nk-btn-ghost nk-btn-sm">
            <FaPrint aria-hidden="true" /> Print
          </button>
        </div>

        <ReadOnlyReviewerReport
          overall={overall}
          projectTitle={call.project_title || 'Untitled proposal'}
          agencyName={call.agency_name || call.parsed_json?.agency_name || null}
          generatedAt={overall.generated_at || call.updated_at || null}
          sections={singleSections}
          compareGroups={compareGroups}
          // A reader without an account cannot open the award or patent
          // detail pages, so the rows are not links here.
          linkAwards={false}
        />

        <p className="py-6 text-center text-xs text-nickel-500 print:hidden">Generated by AIGrantMentor</p>
      </div>
    </div>
  );
}
