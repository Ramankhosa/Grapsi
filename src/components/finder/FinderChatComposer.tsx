import React from 'react';
import { ArrowUp, Check, Paperclip, SlidersHorizontal, X } from 'lucide-react';

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
  selectedResearchAreaIds?: string[];
  onToggleResearchAreaSelection?: (areaId: string) => void;
  onSearchSelectedAreas?: () => void;
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
  selectedResearchAreaIds = [],
  onToggleResearchAreaSelection,
  onSearchSelectedAreas,
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
  const selectedAreas = savedResearchAreas.filter((area) => selectedResearchAreaIds.includes(area.id));

  return (
    <div className="border-t border-hairline bg-ground px-3 py-3 sm:px-5 sm:py-4">
      {attachedContextLabel ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="cb-badge-cobalt">Attached: {attachedContextLabel}</span>
          <button type="button" onClick={onRemoveAttachedContext} className="cb-btn-ghost cb-btn-sm">
            <X className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : null}

      {/* Selection is sticky across turns, so it stays visible outside the attach menu —
          otherwise a later "only India" would silently keep searching areas the user forgot about. */}
      {selectedAreas.length > 0 && onToggleResearchAreaSelection ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-muted">Searching {selectedAreas.length === 1 ? 'area' : `${selectedAreas.length} areas`}:</span>
          {selectedAreas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => onToggleResearchAreaSelection(area.id)}
              title={`Stop searching ${area.label}`}
              className="cb-chip"
            >
              <span className="truncate">{area.label}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
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
          <div className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-xl rounded-xl border border-hairline bg-ground p-4 shadow-cb-pop">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-ink">Attach research context</div>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  Pick a research area or one of your publications. The selected topic guides the funding search.
                </p>
              </div>
              <button type="button" onClick={onCloseAttachMenu} aria-label="Close" className="cb-btn-ghost cb-btn-sm px-2">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid max-h-80 gap-4 overflow-y-auto md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="cb-eyebrow">Saved research areas</div>
                  {selectedResearchAreaIds.length > 0 && onSearchSelectedAreas ? (
                    <button type="button" onClick={onSearchSelectedAreas} className="cb-btn-primary cb-btn-sm">
                      <Check className="h-3.5 w-3.5" />
                      Search {selectedResearchAreaIds.length}{' '}
                      {selectedResearchAreaIds.length === 1 ? 'area' : 'areas'}
                    </button>
                  ) : null}
                </div>
                {savedResearchAreas.length > 0 ? (
                  <>
                    {savedResearchAreas.map((area) => {
                      const isSelected = selectedResearchAreaIds.includes(area.id);
                      return (
                        <button
                          key={area.id}
                          type="button"
                          onClick={() =>
                            onToggleResearchAreaSelection
                              ? onToggleResearchAreaSelection(area.id)
                              : onAttachResearchContext(area.label, buildSavedResearchAreaQueryText(area), 'Saved Research Area')
                          }
                          className={`w-full rounded-lg border px-3 py-2.5 text-left text-[13px] transition ${
                            isSelected
                              ? 'border-cobalt-600 bg-cobalt-50'
                              : 'border-hairline bg-ground hover:border-cobalt-300 hover:bg-cobalt-50'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            {onToggleResearchAreaSelection ? (
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                  isSelected ? 'border-cobalt-600 bg-cobalt-600 text-white' : 'border-hairline bg-ground'
                                }`}
                              >
                                {isSelected ? <Check className="h-2.5 w-2.5" /> : null}
                              </span>
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-ink">{area.label}</div>
                              {formatSavedResearchAreaTaxonomy(area) ? (
                                <div className="mt-0.5 text-[12px] text-muted">{formatSavedResearchAreaTaxonomy(area)}</div>
                              ) : null}
                              <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{area.researchArea}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {onToggleResearchAreaSelection ? (
                      <p className="text-[11.5px] leading-5 text-muted-soft">
                        Pick more than one and each area is searched separately, then merged — so a strong area
                        can&apos;t crowd the others out.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-hairline px-3 py-3 text-[13px] text-muted">
                    No saved research areas yet.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="cb-eyebrow">Profile research areas</div>
                {profileResearchAreas.length > 0 ? (
                  profileResearchAreas.map((area) => (
                    <button
                      key={area}
                      type="button"
                      onClick={() => onAttachResearchContext(area, area, 'Profile Research Area')}
                      className="w-full rounded-lg border border-hairline bg-ground px-3 py-2.5 text-left text-[13px] font-medium text-ink transition hover:border-cobalt-300 hover:bg-cobalt-50"
                    >
                      {area}
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-hairline px-3 py-3 text-[13px] text-muted">
                    Add research areas in your profile to attach them here.
                  </div>
                )}
              </div>

              {onAttachPublicationContext ? (
                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="cb-eyebrow">My publications</div>
                    {selectedPublicationTitles.length > 0 && onConfirmPublications ? (
                      <button type="button" onClick={onConfirmPublications} className="cb-btn-primary cb-btn-sm">
                        <Check className="h-3.5 w-3.5" />
                        Use {selectedPublicationTitles.length}{' '}
                        {selectedPublicationTitles.length === 1 ? 'publication' : 'publications'}
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
                          className={`w-full rounded-lg border px-3 py-2.5 text-left text-[13px] transition ${
                            isSelected
                              ? 'border-cobalt-600 bg-cobalt-50'
                              : 'border-hairline bg-ground hover:border-cobalt-300 hover:bg-cobalt-50'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                isSelected ? 'border-cobalt-600 bg-cobalt-600 text-white' : 'border-hairline bg-ground'
                              }`}
                            >
                              {isSelected ? <Check className="h-2.5 w-2.5" /> : null}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-ink">{publication.title}</div>
                              {publication.venue || publication.year ? (
                                <div className="mt-0.5 text-[12px] text-muted">
                                  {[publication.venue, publication.year].filter(Boolean).join(' · ')}
                                </div>
                              ) : null}
                              {publication.abstract ? (
                                <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{publication.abstract}</div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed border-hairline px-3 py-3 text-[13px] text-muted">
                      Tag library items as <span className="font-medium text-ink-soft">my-publication</span> in Research Fit
                      to attach them here.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* While a turn is in flight the whole composer freezes: no typing, no
            attaching, no filter jumps — the only affordance is the spinner. */}
        <div
          aria-busy={sending}
          className={`flex items-end gap-2 rounded-xl border p-1.5 transition ${
            disabled
              ? 'cursor-not-allowed border-hairline bg-inset opacity-70'
              : 'border-hairline bg-ground focus-within:border-cobalt-600 focus-within:ring-2 focus-within:ring-cobalt-100'
          }`}
        >
          {showFilterButton && onOpenFilters ? (
            <button
              type="button"
              onClick={onOpenFilters}
              disabled={disabled}
              className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 lg:hidden"
              title={activeFilterCount > 0 ? `${activeFilterCount} filters active — tap to edit` : 'Open filters'}
              aria-label="Open filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 ? (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cobalt-600 px-1 text-[10px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onToggleAttachMenu}
            disabled={disabled}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach saved research context"
            aria-label="Attach research context"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <textarea
            ref={composerRef}
            rows={1}
            value={composer}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            disabled={disabled}
            readOnly={sending}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!disabled) onSubmit();
              }
            }}
            placeholder={sending ? 'Waiting for the answer…' : 'Describe your research topic, or ask about a call — eligibility, deadlines, documents…'}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-sm leading-6 text-ink outline-none placeholder:text-muted-soft focus:ring-0 disabled:cursor-not-allowed disabled:text-muted"
          />

          <button
            type="submit"
            disabled={disabled || !composer.trim() || composerOverLimit}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cobalt-600 text-white transition hover:bg-cobalt-700 disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted-soft"
            title={sending ? 'Thinking…' : 'Send'}
            aria-label="Send message"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
          <span className="text-[11px] text-muted-soft">
            {sending ? 'Waiting for the answer — the composer unlocks when it arrives.' : 'Enter to send · Shift + Enter for a new line'}
          </span>
          <span className={`text-[11px] ${composerOverLimit ? 'text-red-600' : 'text-muted-soft'}`}>
            {composerLength.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
          </span>
        </div>
      </form>
    </div>
  );
}
