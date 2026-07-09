import React from 'react';
import { FaCheck, FaFilter, FaPaperclip, FaPaperPlane, FaTimes } from 'react-icons/fa';

import { CHAT_MESSAGE_MAX_LENGTH } from '../../lib/recommendations/constants';
import type { ResearcherFinderContext, ResearcherFinderPublication } from '../../lib/researcherProfile/types';

type SavedResearchArea = ResearcherFinderContext['researchAreas'][number];

export interface FinderChatComposerProps {
  composer: string;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  disabled: boolean;
  composerRef?: React.RefObject<HTMLTextAreaElement>;
  attachMenuOpen: boolean;
  onToggleAttachMenu: () => void;
  onCloseAttachMenu: () => void;
  attachedContextLabel: string | null;
  onRemoveAttachedContext: () => void;
  savedResearchAreas: SavedResearchArea[];
  profileResearchAreas: string[];
  publications?: ResearcherFinderPublication[];
  onAttachResearchContext: (label: string, queryText: string, sourceLabel: string) => void;
  onAttachPublicationContext?: (publication: ResearcherFinderPublication) => void;
  onConfirmPublications?: () => void;
  selectedPublicationTitles?: string[];
  activeFilterCount: number;
  onOpenFilters?: () => void;
  showFilterButton?: boolean;
}

function formatSavedResearchAreaTaxonomy(area: SavedResearchArea) {
  if (!area.taxonomy?.level1Name && !area.taxonomy?.level2Name) return '';
  return [area.taxonomy.level1Name, area.taxonomy.level2Name || 'General'].filter(Boolean).join(' / ');
}

function buildSavedResearchAreaQueryText(area: SavedResearchArea) {
  if (area.normalizedText?.trim()) return area.normalizedText;
  const taxonomyPath = formatSavedResearchAreaTaxonomy(area);
  return [taxonomyPath, area.researchArea].filter(Boolean).join(' | ');
}

export default function FinderChatComposer({
  composer,
  onComposerChange,
  onSubmit,
  sending,
  disabled,
  composerRef,
  attachMenuOpen,
  onToggleAttachMenu,
  onCloseAttachMenu,
  attachedContextLabel,
  onRemoveAttachedContext,
  savedResearchAreas,
  profileResearchAreas,
  publications = [],
  onAttachResearchContext,
  onAttachPublicationContext,
  onConfirmPublications,
  selectedPublicationTitles = [],
  activeFilterCount,
  onOpenFilters,
  showFilterButton = false,
}: FinderChatComposerProps) {
  const composerLength = composer.length;
  const composerOverLimit = composerLength > CHAT_MESSAGE_MAX_LENGTH;

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
      {attachedContextLabel ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900">
            Attached: {attachedContextLabel}
          </span>
          <button
            type="button"
            onClick={onRemoveAttachedContext}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition-colors hover:text-slate-900"
          >
            <FaTimes />
            Remove
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="relative"
      >
        {attachMenuOpen ? (
          <div className="absolute bottom-full left-0 z-10 mb-3 w-full max-w-xl rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attach Research Context</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  Pick a research area or one of your publications. The selected topic guides the funding search.
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseAttachMenu}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:text-slate-900"
              >
                <FaTimes />
              </button>
            </div>

            <div className="mt-4 grid max-h-80 gap-4 overflow-y-auto md:grid-cols-2">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Saved Research Areas</div>
                {savedResearchAreas.length > 0 ? (
                  savedResearchAreas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => onAttachResearchContext(area.label, buildSavedResearchAreaQueryText(area), 'Saved Research Area')}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      <div className="font-semibold text-slate-900">{area.label}</div>
                      {formatSavedResearchAreaTaxonomy(area) ? (
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
                          {formatSavedResearchAreaTaxonomy(area)}
                        </div>
                      ) : null}
                      <div className="mt-1 line-clamp-2 text-slate-600">{area.researchArea}</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                    No saved research areas yet.
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Profile Research Areas</div>
                {profileResearchAreas.length > 0 ? (
                  profileResearchAreas.map((area) => (
                    <button
                      key={area}
                      type="button"
                      onClick={() => onAttachResearchContext(area, area, 'Profile Research Area')}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      <div className="font-semibold text-slate-900">{area}</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                    Add research areas in your profile to attach them here.
                  </div>
                )}
              </div>

              {onAttachPublicationContext ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">My Publications</div>
                    {selectedPublicationTitles.length > 0 && onConfirmPublications ? (
                      <button
                        type="button"
                        onClick={onConfirmPublications}
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-700"
                      >
                        <FaCheck className="text-[10px]" />
                        Use {selectedPublicationTitles.length} {selectedPublicationTitles.length === 1 ? 'publication' : 'publications'}
                      </button>
                    ) : null}
                  </div>
                  {publications.length > 0 ? (
                    publications.map((publication) => {
                      const isSelected = selectedPublicationTitles.includes(publication.title);
                      return (
                        <button
                          key={publication.id}
                          type="button"
                          onClick={() => onAttachPublicationContext(publication)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200'
                              : 'border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : 'border-slate-300 bg-white'
                            }`}>
                              {isSelected ? <FaCheck className="text-[10px]" /> : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900">{publication.title}</div>
                              {publication.venue || publication.year ? (
                                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
                                  {[publication.venue, publication.year].filter(Boolean).join(' · ')}
                                </div>
                              ) : null}
                              {publication.abstract ? (
                                <div className="mt-1 line-clamp-2 text-slate-600">{publication.abstract}</div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                      Tag library items as <span className="font-semibold">my-publication</span> in Research Fit to attach them here.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)] sm:gap-3">
          {showFilterButton && onOpenFilters ? (
            <button
              type="button"
              onClick={onOpenFilters}
              className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors lg:hidden ${
                activeFilterCount > 0
                  ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700'
              }`}
              title={activeFilterCount > 0 ? `${activeFilterCount} filters active — tap to edit` : 'Open filters'}
            >
              <FaFilter />
              {activeFilterCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onToggleAttachMenu}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
            title="Attach saved research context"
          >
            <FaPaperclip />
          </button>

          <textarea
            ref={composerRef}
            rows={2}
            value={composer}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder='Ask anything — "Find fellowships in AI for healthcare", "What documents does result 1 need?", or "How do I strengthen my application?"'
            className="min-h-[52px] flex-1 resize-none rounded-[22px] border-2 border-slate-200 bg-slate-50/50 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />

          <div className={`hidden shrink-0 text-right text-[11px] font-semibold uppercase tracking-[0.12em] sm:block ${composerOverLimit ? 'text-rose-600' : 'text-slate-400'}`}>
            {composerLength.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
          </div>

          <button
            type="submit"
            disabled={disabled || !composer.trim() || composerOverLimit}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-700 hover:shadow-[0_4px_20px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            <FaPaperPlane />
            {sending ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
