import React, { useEffect, useRef } from 'react';
import { FaBolt, FaPlus, FaTrash } from 'react-icons/fa';

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
 * The redesigned AI-assisted search tab: persistent filter/profile sidebar on desktop
 * (stacked on mobile), full-height conversation panel with markdown + streaming, and
 * strictly manual filter control by default.
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

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="order-2 lg:order-1">
        <FinderChatSidebar
          filterMode={conversation?.filterMode || 'manual'}
          onFilterModeChange={chat.handleFilterModeChange}
          filters={conversation?.currentFilters || null}
          onRemoveArrayValue={chat.handleRemoveArrayValue}
          onClearScalar={chat.handleClearScalar}
          onOpenFilterEditor={() => chat.setFilterDrawerOpen(true)}
          onClearAllFilters={chat.handleResetFilters}
          onUndoFilters={chat.lastUndoFilters ? chat.handleUndoFilters : undefined}
          finderContext={finderContext}
          preferences={preferences}
          onPreferencesChange={onPreferencesChange}
          onSearchResearchArea={chat.handleSearchResearchArea}
          disabled={busy}
        />
      </aside>

      <section className="order-1 flex min-h-[560px] flex-col overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.12)] lg:order-2 lg:h-[calc(100vh-220px)]">
        <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white">
                  <FaBolt className="text-xs" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
                  AI Funding Advisor
                </p>
                {conversation ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      conversation.filterMode === 'manual'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-violet-100 text-violet-800'
                    }`}
                    title={
                      conversation.filterMode === 'manual'
                        ? 'You control the filters — the assistant only suggests.'
                        : 'The assistant may apply filters from your messages.'
                    }
                  >
                    {conversation.filterMode === 'manual' ? 'Manual filters' : 'Auto filters'}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-1.5 truncate text-xl font-semibold text-slate-950">
                {conversation?.title || 'Funding Conversation'}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {chat.loadingConversation ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Loading…
                </span>
              ) : null}
              {chat.activeRun?.degradedMode === 'full_text_only' ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                  Full-text fallback
                </span>
              ) : null}
              {chat.activeRun?.lowConfidence ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                  Low confidence
                </span>
              ) : null}
              <button
                type="button"
                onClick={chat.handleCreateConversation}
                disabled={chat.creatingConversation || chat.sending}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaPlus />
                {chat.creatingConversation ? 'Creating…' : 'New Chat'}
              </button>
              <button
                type="button"
                onClick={chat.handleClearChat}
                disabled={!conversation || chat.sending}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaTrash />
                Clear
              </button>
            </div>
          </div>
        </div>

        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,_rgba(248,250,252,0.7),_rgba(255,255,255,0.98))] px-4 py-5 sm:px-6"
        >
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
          <div className="border-t border-slate-200 bg-white px-5 pt-4 sm:px-6">
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
          onAttachResearchContext={chat.handleAttachResearchContext}
          activeFilterCount={activeFilterCount}
          onOpenFilters={() => chat.setFilterDrawerOpen(true)}
          showFilterButton
        />
      </section>
    </div>
  );
}
