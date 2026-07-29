import React, { useEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';

import FinderChatMessage from '../FinderChatMessage';
import FinderPendingFilterConfirmationBar from '../FinderPendingFilterConfirmationBar';
import FinderPendingTurnMessage from '../FinderPendingTurnMessage';
import type { FinderPreferenceValues } from '../FinderPreferencesPanel';
import FinderChatComposer from './FinderChatComposer';
import FinderChatEmptyState from './FinderChatEmptyState';
import FinderChatSidebar from './FinderChatSidebar';
import FinderStreamingMessage from './FinderStreamingMessage';
import { countActiveFilters, type FinderChatController } from '../../hooks/useFinderChat';
import { describeStrictRecoverySentence } from '../../lib/recommendations/finderUi';
import type { ResearcherFinderContext } from '../../lib/researcherProfile/types';

interface FinderAiTabProps {
  chat: FinderChatController;
  finderContext: ResearcherFinderContext | null;
  preferences: FinderPreferenceValues;
  onPreferencesChange: (preferences: FinderPreferenceValues) => void;
  onBeginWriting: (payload: { resultId: string }) => void;
  getCallDetailsHref: (resultId: string) => string;
}

/**
 * The AI-assisted search tab. On desktop the filter/profile rail sits beside a
 * full-height conversation; below `lg` the rail moves into a slide-over so the
 * chat keeps the whole screen and the composer stays pinned to the bottom.
 */
export default function FinderAiTab({
  chat,
  finderContext,
  preferences,
  onPreferencesChange,
  onBeginWriting,
  getCallDetailsHref,
}: FinderAiTabProps) {
  const { conversation } = chat;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [
    conversation?.messages.length,
    conversation?.lastRunId,
    chat.pendingTurn?.status,
    chat.streamingTurn?.text,
    chat.streamingTurn?.stages.length,
    chat.streamingTurn?.results?.length,
    chat.sending,
  ]);

  useEffect(() => {
    if (!railOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [railOpen]);

  const hasRenderableConversationMessages = Boolean(
    (conversation?.messages.length || 0) > 0 || chat.pendingTurn || chat.streamingTurn
  );
  const activeFilterCount = conversation ? countActiveFilters(conversation.currentFilters) : 0;
  const busy = chat.sending || chat.loadingConversation;

  async function handleExplainResult(payload: { ordinal: number }) {
    await chat.handleSendMessage(`Explain result ${payload.ordinal}.`);
  }

  async function handleAskAboutCall(payload: { ordinal: number }) {
    chat.setComposer(`What are the eligibility rules and required documents for result ${payload.ordinal}?`);
    chat.composerRef.current?.focus();
  }

  const rail = (
    <FinderChatSidebar
      filterMode={conversation?.filterMode || 'manual'}
      onFilterModeChange={chat.handleFilterModeChange}
      filters={conversation?.currentFilters || null}
      onRemoveArrayValue={chat.handleRemoveArrayValue}
      onClearScalar={chat.handleClearScalar}
      onOpenFilterEditor={() => {
        setRailOpen(false);
        chat.setFilterDrawerOpen(true);
      }}
      onClearAllFilters={chat.handleResetFilters}
      onUndoFilters={chat.lastUndoFilters ? chat.handleUndoFilters : undefined}
      finderContext={finderContext}
      preferences={preferences}
      onPreferencesChange={onPreferencesChange}
      onSearchResearchArea={(label, queryText) => {
        setRailOpen(false);
        chat.handleSearchResearchArea(label, queryText);
      }}
      disabled={busy}
    />
  );

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="hidden lg:block">{rail}</aside>

      {/* Mobile slide-over holding the same rail. */}
      {railOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters and research profile">
          <button type="button" aria-label="Close panel" onClick={() => setRailOpen(false)} className="absolute inset-0 bg-ink/25" />
          <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col bg-inset shadow-cb-sheet">
            <div className="flex items-center justify-between gap-3 border-b border-hairline bg-ground px-4 py-3">
              <span className="text-[15px] font-semibold text-ink">Search context</span>
              <button type="button" onClick={() => setRailOpen(false)} aria-label="Close" className="cb-btn-ghost cb-btn-sm px-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{rail}</div>
          </div>
        </div>
      ) : null}

      <section className="cb-card flex h-[calc(100dvh-15rem)] min-h-[520px] flex-col overflow-hidden lg:h-[calc(100vh-12.5rem)]">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              className="cb-btn-secondary cb-btn-sm relative shrink-0 px-2.5 lg:hidden"
              aria-label="Open filters and research profile"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cobalt-600 px-1 text-[10px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {conversation?.title || 'Funding conversation'}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {conversation ? (
                  <span
                    className="cb-badge"
                    title={
                      conversation.filterMode === 'manual'
                        ? 'You control the filters — the assistant only suggests.'
                        : 'The assistant may apply filters from your messages.'
                    }
                  >
                    {conversation.filterMode === 'manual' ? 'Manual filters' : 'Auto filters'}
                  </span>
                ) : null}
                {chat.loadingConversation ? <span className="cb-badge">Loading…</span> : null}
                {chat.activeRun?.degradedMode === 'full_text_only' ? (
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    Full-text fallback
                  </span>
                ) : null}
                {chat.activeRun?.lowConfidence ? (
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    Low confidence
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={chat.handleCreateConversation}
              disabled={chat.creatingConversation || chat.sending}
              className="cb-btn-secondary cb-btn-sm"
              title="Start a new conversation"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{chat.creatingConversation ? 'Creating…' : 'New chat'}</span>
            </button>
            <button
              type="button"
              onClick={chat.handleClearChat}
              disabled={!conversation || chat.sending}
              className="cb-btn-danger cb-btn-sm px-2"
              title="Clear this conversation"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={chatScrollRef} className="flex-1 overflow-y-auto bg-ground px-3 py-4 sm:px-5">
          {!conversation || !hasRenderableConversationMessages ? (
            <FinderChatEmptyState
              finderContext={finderContext}
              starterPrompts={chat.starterPrompts}
              onSendMessage={chat.handleSendMessage}
              disabled={chat.sending || !conversation}
            />
          ) : (
            <div className="space-y-5">
              {conversation.messages.map((message) => (
                <FinderChatMessage
                  key={message.id}
                  message={message}
                  runs={conversation.runs}
                  onExplainResult={handleExplainResult}
                  onAskAboutCall={handleAskAboutCall}
                  onBeginWriting={onBeginWriting}
                  onSuggestedReply={chat.handleSendMessage}
                  onApplyFilterChip={chat.handleApplyFilterChip}
                  suggestedReplyDisabled={chat.sending}
                  getCallDetailsHref={getCallDetailsHref}
                  strictRecoveryAction={
                    message.id === chat.latestAssistantMessageId &&
                    conversation.filterMode === 'auto' &&
                    chat.activeRun?.noResultsReason === 'filters_too_strict' &&
                    chat.activeRun.searchDiagnostics?.strictFilterRecovery
                      ? {
                          summary: describeStrictRecoverySentence(
                            conversation.currentFilters,
                            chat.activeRun.searchDiagnostics.strictFilterRecovery
                          ),
                          onRetry: chat.handleRetryWithoutStrictFilters,
                        }
                      : null
                  }
                />
              ))}
              {chat.pendingTurn ? (
                <FinderPendingTurnMessage
                  createdAt={chat.pendingTurn.createdAt}
                  message={chat.pendingTurn.message}
                  status={chat.pendingTurn.status}
                  error={chat.pendingTurn.error}
                  onRetry={chat.handleRetryPendingTurn}
                  onEdit={chat.handleEditPendingTurn}
                  onDismiss={chat.handleDismissPendingTurn}
                />
              ) : null}
              {chat.streamingTurn ? (
                <FinderStreamingMessage turn={chat.streamingTurn} getCallDetailsHref={getCallDetailsHref} />
              ) : null}
            </div>
          )}
        </div>

        {conversation?.pendingFilterPatch && conversation.filterMode === 'auto' ? (
          <div className="border-t border-hairline bg-ground px-3 pt-3 sm:px-5">
            <FinderPendingFilterConfirmationBar
              pendingPatch={conversation.pendingFilterPatch}
              disabled={chat.sending}
              onConfirm={() => chat.handleConfirmPending(true)}
              onReject={() => chat.handleConfirmPending(false)}
            />
          </div>
        ) : null}

        <FinderChatComposer
          composer={chat.composer}
          onComposerChange={chat.setComposer}
          onSubmit={chat.handleSubmitComposer}
          sending={chat.sending}
          disabled={chat.sending || !conversation}
          composerRef={chat.composerRef}
          attachMenuOpen={chat.attachMenuOpen}
          onToggleAttachMenu={() => chat.setAttachMenuOpen(!chat.attachMenuOpen)}
          onCloseAttachMenu={() => chat.setAttachMenuOpen(false)}
          attachedContextLabel={chat.attachedContext?.sourceLabel || null}
          onRemoveAttachedContext={() => {
            chat.setAttachedContext(null);
            chat.setComposer('');
          }}
          savedResearchAreas={finderContext?.researchAreas || []}
          profileResearchAreas={finderContext?.profile.researchAreas || []}
          publications={finderContext?.publications || []}
          onAttachResearchContext={chat.handleAttachResearchContext}
          onAttachPublicationContext={chat.handleAttachPublicationContext}
          onConfirmPublications={chat.handleConfirmPublications}
          selectedPublicationTitles={chat.attachedContext?.papers?.map((p) => p.title) || []}
          activeFilterCount={activeFilterCount}
          onOpenFilters={() => chat.setFilterDrawerOpen(true)}
          showFilterButton
        />
      </section>
    </div>
  );
}
