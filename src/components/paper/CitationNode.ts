/**
 * CitationNode — Custom TipTap inline Node for citation markers.
 *
 * Without this extension ProseMirror strips the `data-cite-key` attribute
 * from `<span>` elements during its HTML parse/serialize cycle.  That means
 * any user edit causes `ed.getHTML()` to lose citation identity, breaking
 * the `[CITE:key]` round-trip and ultimately the bibliography generator.
 *
 * This node:
 *  - Parses `<span data-cite-key="…">` elements produced by `markdownToHtml`
 *  - Stores `citationKey`, `label`, `styleCode` and `order` as attributes
 *    inside the ProseMirror document model
 *  - Serializes back to `<span data-cite-key="…">` in `getHTML()`,
 *    allowing `htmlToMarkdown` to recover `[CITE:key]` losslessly
 *  - Is an `atom` node — users can select & delete it but cannot edit its
 *    content, which mirrors the previous `contenteditable="false"` behaviour
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const CitationNode = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  // ── Attribute definitions ────────────────────────────────────────────
  addAttributes() {
    return {
      citationKey: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cite-key') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.citationKey) return {};
          return { 'data-cite-key': attributes.citationKey };
        },
      },
      label: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cite-label') ||
          element.textContent?.trim() ||
          '',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.label) return {};
          return { 'data-cite-label': attributes.label };
        },
      },
      styleCode: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cite-style') || '',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.styleCode) return {};
          return { 'data-cite-style': attributes.styleCode };
        },
      },
      order: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-cite-order');
          if (!raw) return null;
          const num = parseInt(raw, 10);
          return Number.isFinite(num) ? num : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.order == null) return {};
          return { 'data-cite-order': String(attributes.order) };
        },
      },
    };
  },

  // ── HTML → ProseMirror parsing rule ──────────────────────────────────
  parseHTML() {
    return [
      {
        tag: 'span[data-cite-key]',
      },
    ];
  },

  // ── ProseMirror → HTML serialisation ─────────────────────────────────
  renderHTML({ HTMLAttributes }) {
    const label =
      HTMLAttributes['data-cite-label'] ||
      (HTMLAttributes['data-cite-key']
        ? `[${HTMLAttributes['data-cite-key']}]`
        : '[CITE]');

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'paper-citation-chip',
        contenteditable: 'false',
      }),
      label,
    ];
  },
});
