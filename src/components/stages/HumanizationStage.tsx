'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

interface HumanizationStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
}

type HumanizationStatus =
  | 'not_started'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'outdated';

type CitationValidation = {
  checkedAt: string;
  draftCitationKeys: string[];
  humanizedCitationKeys: string[];
  missingCitationKeys: string[];
  extraCitationKeys: string[];
  valid: boolean;
};

type HumanizationSection = {
  sectionKey: string;
  label: string;
  status: HumanizationStatus;
  draftWordCount: number;
  humanizedWordCount: number;
  draftFingerprint: string;
  sourceDraftFingerprint: string | null;
  draftContent: string;
  humanizedContent: string;
  provider: string | null;
  lastHumanizedAt: string | null;
  lastValidatedAt: string | null;
  citationValidation: CitationValidation | null;
  error: string | null;
};

type HumanizationSummary = {
  total: number;
  completed: number;
  outdated: number;
  failed: number;
  pending: number;
};

function statusBadgeClass(status: HumanizationStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'outdated':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'failed':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'processing':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function statusLabel(status: HumanizationStatus): string {
  switch (status) {
    case 'completed':
      return 'Humanized';
    case 'outdated':
      return 'Outdated';
    case 'failed':
      return 'Failed';
    case 'processing':
      return 'Processing';
    default:
      return 'Not started';
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export default function HumanizationStage({
  sessionId,
  authToken,
  onSessionUpdated
}: HumanizationStageProps) {
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<HumanizationSection[]>([]);
  const [summary, setSummary] = useState<HumanizationSummary>({
    total: 0,
    completed: 0,
    outdated: 0,
    failed: 0,
    pending: 0
  });
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'draft' | 'humanized' | 'compare'>('draft');
  const [humanizedEdits, setHumanizedEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning'>('success');
  const [busySectionKey, setBusySectionKey] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const showMessage = useCallback((text: string, type: 'success' | 'error' | 'warning') => {
    setMessage(text);
    setMessageType(type);
    window.setTimeout(() => setMessage(null), 3500);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!onSessionUpdated || !authToken) return;
    const response = await fetch(`/api/papers/${sessionId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    onSessionUpdated(data.session);
  }, [sessionId, authToken, onSessionUpdated]);

  const loadData = useCallback(async () => {
    if (!sessionId || !authToken) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'get_humanization_data' })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load humanization data');
      }

      const nextSections = Array.isArray(data.sections) ? data.sections : [];
      setSections(nextSections);
      setSummary(data.summary || {
        total: nextSections.length,
        completed: 0,
        outdated: 0,
        failed: 0,
        pending: nextSections.length
      });

      setSelectedSectionKey((prev) => {
        if (prev && nextSections.some((section: HumanizationSection) => section.sectionKey === prev)) {
          return prev;
        }
        return nextSections[0]?.sectionKey || null;
      });
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Failed to load humanization data',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken, showMessage]);

  useEffect(() => {
    loadData().catch(() => undefined);
  }, [loadData]);

  const selectedSection = useMemo(
    () => sections.find((section) => section.sectionKey === selectedSectionKey) || null,
    [sections, selectedSectionKey]
  );

  useEffect(() => {
    if (!selectedSection) return;
    setHumanizedEdits((prev) => {
      if (prev[selectedSection.sectionKey] !== undefined) return prev;
      return {
        ...prev,
        [selectedSection.sectionKey]: selectedSection.humanizedContent || ''
      };
    });
  }, [selectedSection]);

  const currentHumanizedText = selectedSection
    ? (humanizedEdits[selectedSection.sectionKey] ?? selectedSection.humanizedContent ?? '')
    : '';

  const hasUnsavedHumanizedEdit = Boolean(
    selectedSection
    && (humanizedEdits[selectedSection.sectionKey] ?? selectedSection.humanizedContent ?? '') !== selectedSection.humanizedContent
  );

  const humanizeSection = useCallback(async (section: HumanizationSection) => {
    if (!authToken) return;
    setBusySectionKey(section.sectionKey);
    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'humanize_section',
          sectionKey: section.sectionKey,
          sourceDraftFingerprint: section.draftFingerprint
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Humanization failed');
      }

      const updatedSection = data.section as HumanizationSection | null;
      if (updatedSection) {
        setSections((prev) => prev.map((item) => (
          item.sectionKey === updatedSection.sectionKey ? updatedSection : item
        )));
        setHumanizedEdits((prev) => ({
          ...prev,
          [updatedSection.sectionKey]: updatedSection.humanizedContent || ''
        }));
      }
      if (data.summary) {
        setSummary(data.summary);
      }
      setTab('humanized');
      showMessage(`Humanized ${section.label}`, 'success');
      await refreshSession();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Humanization failed', 'error');
      await loadData();
      await refreshSession();
    } finally {
      setBusySectionKey(null);
    }
  }, [authToken, sessionId, showMessage, refreshSession, loadData]);

  const saveHumanizedSection = useCallback(async () => {
    if (!selectedSection || !authToken) return;
    setBusySectionKey(selectedSection.sectionKey);
    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'save_humanized_section',
          sectionKey: selectedSection.sectionKey,
          content: currentHumanizedText
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save humanized content');
      }

      const updatedSection = data.section as HumanizationSection | null;
      if (updatedSection) {
        setSections((prev) => prev.map((item) => (
          item.sectionKey === updatedSection.sectionKey ? updatedSection : item
        )));
        setHumanizedEdits((prev) => ({
          ...prev,
          [updatedSection.sectionKey]: updatedSection.humanizedContent || ''
        }));
      }
      if (data.summary) setSummary(data.summary);
      showMessage(`Saved humanized text for ${selectedSection.label}`, 'success');
      await refreshSession();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Save failed', 'error');
    } finally {
      setBusySectionKey(null);
    }
  }, [selectedSection, authToken, sessionId, currentHumanizedText, showMessage, refreshSession]);

  const validateCitations = useCallback(async (validateAll = false) => {
    if (!authToken) return;
    const targetSectionKey = validateAll ? null : selectedSection?.sectionKey || null;
    setBusySectionKey(targetSectionKey || '__all__');
    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'validate_humanized_citations',
          sectionKey: targetSectionKey || undefined,
          validateAll
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Citation validation failed');
      }

      await loadData();
      const invalidCount = Number(data.invalidCount || 0);
      if (invalidCount > 0) {
        showMessage(`${invalidCount} section(s) are missing draft citations`, 'warning');
      } else {
        showMessage('Citation validation passed', 'success');
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Citation validation failed', 'error');
    } finally {
      setBusySectionKey(null);
    }
  }, [authToken, selectedSection, sessionId, showMessage, loadData]);

  const humanizeAll = useCallback(async () => {
    if (!authToken) return;
    const queue = sections.filter((section) => section.draftContent.trim().length > 0);
    if (queue.length === 0) {
      showMessage('No drafted sections available to humanize', 'warning');
      return;
    }

    setBulkRunning(true);
    let success = 0;
    let failed = 0;

    for (const section of queue) {
      setBusySectionKey(section.sectionKey);
      try {
        const response = await fetch(`/api/papers/${sessionId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            action: 'humanize_section',
            sectionKey: section.sectionKey,
            sourceDraftFingerprint: section.draftFingerprint
          })
        });
        const data = await response.json();
        if (!response.ok) {
          failed += 1;
          continue;
        }

        const updatedSection = data.section as HumanizationSection | null;
        if (updatedSection) {
          setSections((prev) => prev.map((item) => (
            item.sectionKey === updatedSection.sectionKey ? updatedSection : item
          )));
          setHumanizedEdits((prev) => ({
            ...prev,
            [updatedSection.sectionKey]: updatedSection.humanizedContent || ''
          }));
        }
        success += 1;
      } catch {
        failed += 1;
      }
    }

    setBusySectionKey(null);
    setBulkRunning(false);
    await loadData();
    await refreshSession();

    if (failed > 0) {
      showMessage(`Humanized ${success} section(s), ${failed} failed`, 'warning');
    } else {
      showMessage(`Humanized ${success} section(s)`, 'success');
    }
  }, [authToken, sections, sessionId, loadData, refreshSession, showMessage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        <span className="ml-3 text-sm text-slate-600">Loading humanization workspace...</span>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {message && (
        <div className={`rounded-lg border px-4 py-2 text-sm ${
          messageType === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : messageType === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
        }`}>
          {message}
        </div>
      )}

      <Card className="border-0 shadow-md bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 text-white">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-300" />
                Humanization Studio
              </CardTitle>
              <CardDescription className="text-slate-300">
                Humanize section drafts and validate citation retention against draft references.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="bg-white/10 text-white hover:bg-white/20 border border-white/20"
                onClick={humanizeAll}
                disabled={bulkRunning || sections.length === 0}
              >
                {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Humanize All
              </Button>
              <Button
                variant="secondary"
                className="bg-white/10 text-white hover:bg-white/20 border border-white/20"
                onClick={() => validateCitations(true)}
                disabled={Boolean(busySectionKey)}
              >
                Validate All Citations
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2">
              <div className="text-xs text-slate-300">Sections</div>
              <div className="text-lg font-semibold">{summary.total}</div>
            </div>
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2">
              <div className="text-xs text-slate-300">Humanized</div>
              <div className="text-lg font-semibold">{summary.completed}</div>
            </div>
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2">
              <div className="text-xs text-slate-300">Outdated</div>
              <div className="text-lg font-semibold">{summary.outdated}</div>
            </div>
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2">
              <div className="text-xs text-slate-300">Failed</div>
              <div className="text-lg font-semibold">{summary.failed}</div>
            </div>
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2">
              <div className="text-xs text-slate-300">Pending</div>
              <div className="text-lg font-semibold">{summary.pending}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[620px] overflow-y-auto">
            {sections.map((section) => (
              <button
                key={section.sectionKey}
                type="button"
                onClick={() => setSelectedSectionKey(section.sectionKey)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  selectedSectionKey === section.sectionKey
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800 truncate">{section.label}</div>
                  <Badge className={`text-[10px] border ${statusBadgeClass(section.status)}`}>
                    {statusLabel(section.status)}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Draft {section.draftWordCount}w | Humanized {section.humanizedWordCount}w
                </div>
              </button>
            ))}
            {sections.length === 0 && (
              <div className="text-sm text-slate-500">No drafted sections found yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {selectedSection?.label || 'Select a section'}
                </CardTitle>
                <CardDescription>
                  Draft is preserved. Humanized output is tracked separately.
                </CardDescription>
              </div>
              {selectedSection && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => humanizeSection(selectedSection)}
                    disabled={busySectionKey === selectedSection.sectionKey || !selectedSection.draftContent.trim()}
                  >
                    {busySectionKey === selectedSection.sectionKey
                      ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      : <Sparkles className="w-4 h-4 mr-2" />}
                    {selectedSection.status === 'completed' ? 'Re-humanize' : 'Humanize'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => validateCitations(false)}
                    disabled={Boolean(busySectionKey) || !selectedSection.humanizedContent.trim()}
                  >
                    Validate citations
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 inline-flex rounded-lg border border-slate-200 p-1 bg-slate-100">
              {(['draft', 'humanized', 'compare'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`px-3 py-1.5 text-sm rounded-md transition ${
                    tab === item
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item === 'draft' ? 'Draft' : item === 'humanized' ? 'Humanized' : 'Compare'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedSection && (
              <div className="text-sm text-slate-500">Pick a section from the left panel.</div>
            )}

            {selectedSection && tab === 'draft' && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500">
                  Source draft ({selectedSection.draftWordCount} words)
                </div>
                <Textarea value={selectedSection.draftContent} readOnly rows={18} />
              </div>
            )}

            {selectedSection && tab === 'humanized' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Last humanized: {formatDateTime(selectedSection.lastHumanizedAt)}</span>
                  <span>|</span>
                  <span>Last citation check: {formatDateTime(selectedSection.lastValidatedAt)}</span>
                </div>
                <Textarea
                  value={currentHumanizedText}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHumanizedEdits((prev) => ({
                      ...prev,
                      [selectedSection.sectionKey]: nextValue
                    }));
                  }}
                  rows={18}
                  placeholder="Humanized output will appear here."
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">
                    {hasUnsavedHumanizedEdit ? 'Unsaved changes' : `Words: ${selectedSection.humanizedWordCount}`}
                  </div>
                  <Button
                    onClick={saveHumanizedSection}
                    disabled={!hasUnsavedHumanizedEdit || busySectionKey === selectedSection.sectionKey}
                  >
                    {busySectionKey === selectedSection.sectionKey
                      ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      : null}
                    Save Humanized
                  </Button>
                </div>
                {selectedSection.error && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {selectedSection.error}
                  </div>
                )}
              </div>
            )}

            {selectedSection && tab === 'compare' && (
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Draft</div>
                  <Textarea value={selectedSection.draftContent} readOnly rows={16} />
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Humanized</div>
                  <Textarea value={currentHumanizedText} readOnly rows={16} />
                </div>
              </div>
            )}

            {selectedSection?.citationValidation && (
              <div className={`rounded-lg border px-4 py-3 ${
                selectedSection.citationValidation.valid
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
              }`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {selectedSection.citationValidation.valid
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    : <AlertCircle className="w-4 h-4 text-amber-600" />}
                  {selectedSection.citationValidation.valid
                    ? 'Citation parity check passed'
                    : 'Citation parity check found missing citations'}
                </div>
                <div className="mt-2 text-xs text-slate-700">
                  Draft keys: {selectedSection.citationValidation.draftCitationKeys.length} | Humanized keys: {selectedSection.citationValidation.humanizedCitationKeys.length}
                </div>
                {selectedSection.citationValidation.missingCitationKeys.length > 0 && (
                  <div className="mt-2 text-xs text-amber-700">
                    Missing in humanized: {selectedSection.citationValidation.missingCitationKeys.join(', ')}
                  </div>
                )}
                {selectedSection.citationValidation.extraCitationKeys.length > 0 && (
                  <div className="mt-1 text-xs text-slate-600">
                    Extra in humanized: {selectedSection.citationValidation.extraCitationKeys.join(', ')}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
