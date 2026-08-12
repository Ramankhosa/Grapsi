/**
 * Pure helpers for routing parsed document sections into extraction inputs.
 * Guideline and template extraction both compose their LLM source text from
 * typed sections instead of the whole flat document.
 */

export interface RoutedSectionLike {
  id: string;
  document_id: string;
  section_type: string;
  section_title: string | null;
  section_text: string;
  classification_method: string;
  order_index: number;
}

export interface ComposedSectionSource {
  text: string;
  usedSectionIds: string[];
  usedSectionTypes: string[];
  usedDocumentIds: string[];
  /** True when type filtering was abandoned (unclassifiable document) and every section was used. */
  usedAllSections: boolean;
  truncated: boolean;
}

function humanizeSectionType(sectionType: string) {
  return sectionType.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * Compose extraction source text from the sections whose type matches
 * `relevantTypes`. When the document did not sectionize meaningfully — no
 * relevant sections, or everything was fallback-classified — the full section
 * list is used instead so routing never loses content it cannot see.
 */
export function composeRoutedSectionText(
  sections: RoutedSectionLike[],
  relevantTypes: readonly string[],
  options: {
    /** Label per document id, shown when more than one document contributes. */
    documentLabels?: Map<string, string>;
    maxChars?: number;
  } = {}
): ComposedSectionSource {
  const usable = sections.filter((section) => String(section.section_text || '').trim());
  const relevantSet = new Set(relevantTypes);
  const typedMatches = usable.filter((section) => relevantSet.has(section.section_type));
  const confidentMatches = typedMatches.filter((section) => section.classification_method !== 'fallback');

  const useAll = confidentMatches.length === 0;
  const selected = useAll ? usable : typedMatches;

  const contributingDocuments = new Set(selected.map((section) => section.document_id));
  const multiDocument = contributingDocuments.size > 1;

  const parts: string[] = [];
  let previousDocumentId: string | null = null;
  let documentCounter = 0;
  for (const section of selected) {
    if (multiDocument && section.document_id !== previousDocumentId) {
      documentCounter += 1;
      const label = options.documentLabels?.get(section.document_id) || `Document ${documentCounter}`;
      parts.push(`# Source: ${label}`);
      previousDocumentId = section.document_id;
    }
    const heading = section.section_title?.trim() || humanizeSectionType(section.section_type);
    parts.push(`## ${heading}\n${String(section.section_text).trim()}`);
  }

  let text = parts.join('\n\n');
  let truncated = false;
  if (options.maxChars && text.length > options.maxChars) {
    text = text.slice(0, options.maxChars);
    truncated = true;
  }

  return {
    text,
    usedSectionIds: selected.map((section) => section.id),
    usedSectionTypes: Array.from(new Set(selected.map((section) => section.section_type))),
    usedDocumentIds: Array.from(contributingDocuments),
    usedAllSections: useAll,
    truncated,
  };
}
