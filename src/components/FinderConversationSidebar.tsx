import { FaComments, FaPlus, FaTrash } from 'react-icons/fa';
import type { RecommendationConversationSummary } from '../lib/recommendations/chatTypes';

interface FinderConversationSidebarProps {
  conversations: RecommendationConversationSummary[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onDelete: (conversationId: string) => void;
  creating: boolean;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function FinderConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
  creating,
}: FinderConversationSidebarProps) {
  return (
    <aside className="rounded-[28px] border border-white/60 bg-slate-950 p-5 text-white shadow-[0_30px_80px_rgba(15,23,42,0.32)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-300">Finder Chats</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Funding Conversations</h2>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FaPlus />
          {creating ? 'Creating...' : 'New'}
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {conversations.length === 0 ? (
          <div className="rounded-[22px] border border-white/10 bg-white/5 p-5 text-sm leading-6 text-slate-300">
            Start a funding conversation to search, refine filters, compare opportunities, and explain matches.
          </div>
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <div
                key={conversation.id}
                className={`rounded-[22px] border px-4 py-4 transition-all ${
                  active
                    ? 'border-emerald-300/60 bg-emerald-400/12 shadow-[0_12px_30px_rgba(16,185,129,0.18)]'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                }`}
              >
                <button type="button" onClick={() => onSelect(conversation.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{conversation.title}</div>
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-300">
                        {conversation.preview || 'No messages yet.'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{formatTimestamp(conversation.updatedAt)}</span>
                      {conversation.hasPendingPatch ? (
                        <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                          Pending
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                    <FaComments />
                    {conversation.currentInputMode === 'paper_metadata' ? 'Paper Mode' : 'Research Area'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(conversation.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 transition-colors hover:border-rose-300/40 hover:bg-rose-400/10 hover:text-rose-100"
                  >
                    <FaTrash />
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
