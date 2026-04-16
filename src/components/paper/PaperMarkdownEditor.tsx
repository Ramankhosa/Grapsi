'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useCallback, type MouseEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Underline from '@tiptap/extension-underline';
import { CitationNode } from './CitationNode';
import { FigureNode } from './FigureNode';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  Bold,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  Undo2
} from 'lucide-react';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';

// ============================================================================
// Public Ref API
// ============================================================================

export interface PaperMarkdownEditorRef {
  focus: () => void;
  insertTextAtCursor: (text: string) => void;
  replaceSelection: (text: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  getSelectedText: () => string;
  getMarkdown: () => string;
  /** Store the current selection so it survives blur events */
  saveSelection: () => { from: number; to: number } | null;
  /** Restore a previously saved selection */
  restoreSelection: (range: { from: number; to: number }) => void;
}

// ============================================================================
// Props
// ============================================================================

interface PaperMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (selection: { text: string; start: number; end: number } | null) => void;
  onFigureClick?: (figureNo: number) => void;
  citationDisplayMeta?: PaperCitationDisplayMeta;
  figureDisplayMeta?: PaperFigureDisplayMeta;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export interface PaperCitationDisplayMeta {
  styleCode: string;
  displayByKey: Record<string, string>;
  orderByKey?: Record<string, number>;
  signature?: string;
}

export interface PaperFigureDisplayMeta {
  byNo: Record<number, { title?: string; imagePath?: string }>;
  signature?: string;
}

// ============================================================================
// Markdown ↔ HTML Conversion Helpers
// ============================================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FIGURE_MARKER_REGEX = /\[Figure\s+(\d+)\]/i;
const INLINE_MARKER_REGEX = /\[CITE:([^\]]+)\]|\[Figure\s+(\d+)\]/gi;
const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi;

function splitCitationKeys(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLegacyCitationSpanMarkup(markdown: string): string {
  if (!markdown || !markdown.includes('data-cite-key')) {
    return markdown;
  }

  return markdown.replace(LEGACY_CITATION_SPAN_REGEX, (_full, keyA, keyB) => {
    const citationKey = String(keyA || keyB || '').trim();
    if (!citationKey) return _full;
    return `[CITE:${citationKey}]`;
  });
}

function resolveCitationLabel(
  citationKey: string,
  citationDisplayMeta?: PaperCitationDisplayMeta
): { label: string; order?: number } {
  const key = String(citationKey || '').trim();
  const displayByKey = citationDisplayMeta?.displayByKey || {};
  const fallbackLabel = key ? `[${key}]` : '[CITE]';
  const labelRaw = typeof displayByKey[key] === 'string' ? displayByKey[key].trim() : '';
  const label = labelRaw || fallbackLabel;

  const orderRaw = Number(citationDisplayMeta?.orderByKey?.[key]);
  const order = Number.isFinite(orderRaw) && orderRaw > 0 ? Math.trunc(orderRaw) : undefined;

  return { label, order };
}

function renderCitationChipHtml(
  citationKey: string,
  citationDisplayMeta?: PaperCitationDisplayMeta
): string {
  const key = String(citationKey || '').trim();
  if (!key) return '';

  const { label, order } = resolveCitationLabel(key, citationDisplayMeta);
  const styleCode = String(citationDisplayMeta?.styleCode || '').trim();
  const attrs = [
    'class="paper-citation-chip"',
    'contenteditable="false"',
    `data-cite-key="${escapeHtml(key)}"`,
    `data-cite-label="${escapeHtml(label)}"`
  ];

  if (styleCode) {
    attrs.push(`data-cite-style="${escapeHtml(styleCode)}"`);
  }
  if (typeof order === 'number') {
    attrs.push(`data-cite-order="${order}"`);
  }

  return `<span ${attrs.join(' ')}>${escapeHtml(label)}</span>`;
}

function resolveFigureMeta(
  figureNo: number,
  figureDisplayMeta?: PaperFigureDisplayMeta
): { title: string; imagePath: string } {
  const meta = figureDisplayMeta?.byNo?.[figureNo];
  const title = typeof meta?.title === 'string' ? meta.title.trim() : '';
  const imagePath = typeof meta?.imagePath === 'string' ? meta.imagePath.trim() : '';
  return { title, imagePath };
}

function renderFigureChipHtml(
  figureNo: number,
  figureDisplayMeta?: PaperFigureDisplayMeta
): string {
  if (!Number.isFinite(figureNo) || figureNo <= 0) {
    return '';
  }

  const safeNo = Math.trunc(figureNo);
  const figureLabel = `[Figure ${safeNo}]`;
  const { title, imagePath } = resolveFigureMeta(safeNo, figureDisplayMeta);
  const accessibleLabel = title ? `Figure ${safeNo}: ${title}` : `Figure ${safeNo}`;
  const attrs = [
    'class="paper-figure-chip"',
    'contenteditable="false"',
    `data-figure-no="${safeNo}"`
  ];

  if (title) {
    attrs.push(`data-figure-title="${escapeHtml(title)}"`);
  }
  if (imagePath) {
    attrs.push(`data-figure-image-path="${escapeHtml(imagePath)}"`);
  }

  attrs.push(`title="${escapeHtml(accessibleLabel)}"`);

  return `<span ${attrs.join(' ')}><span class="paper-figure-chip-label">${escapeHtml(figureLabel)}</span></span>`;
}

function convertMarkersToInlineHtml(
  text: string,
  citationDisplayMeta?: PaperCitationDisplayMeta,
  figureDisplayMeta?: PaperFigureDisplayMeta
): string {
  if (!text) return '';

  let html = '';
  let cursor = 0;
  INLINE_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = INLINE_MARKER_REGEX.exec(text)) !== null) {
    html += escapeHtml(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (match[1]) {
      const citationKeys = splitCitationKeys(match[1] || '');
      if (citationKeys.length === 0) {
        html += escapeHtml(match[0]);
        continue;
      }

      const chips = citationKeys
        .map((citationKey) => renderCitationChipHtml(citationKey, citationDisplayMeta))
        .filter(Boolean);
      html += chips.length > 0 ? chips.join(' ') : escapeHtml(match[0]);
      continue;
    }

    if (match[2]) {
      const figureNo = Number.parseInt(match[2], 10);
      const chip = renderFigureChipHtml(figureNo, figureDisplayMeta);
      html += chip || escapeHtml(match[0]);
      continue;
    }

    html += escapeHtml(match[0]);
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

function inlineMarkdownToHtml(
  text: string,
  citationDisplayMeta?: PaperCitationDisplayMeta,
  figureDisplayMeta?: PaperFigureDisplayMeta
): string {
  let html = convertMarkersToInlineHtml(text, citationDisplayMeta, figureDisplayMeta);
  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (but not inside bold markers)
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Superscript ^text^
  html = html.replace(/\^([^^]+)\^/g, '<sup>$1</sup>');
  // Subscript ~text~ (single tilde, not double)
  html = html.replace(/(?<![~])~([^~]+)~(?!~)/g, '<sub>$1</sub>');
  return html;
}

function inlineHtmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'span') {
    const figureNoRaw = el.getAttribute('data-figure-no');
    if (figureNoRaw && figureNoRaw.trim()) {
      const parsed = Number.parseInt(figureNoRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return `[Figure ${Math.trunc(parsed)}]`;
      }
    }

    const citationKey = el.getAttribute('data-cite-key');
    if (citationKey && citationKey.trim()) {
      return `[CITE:${citationKey.trim()}]`;
    }
  }

  if (tag === 'img') {
    const src = String(el.getAttribute('src') || '').trim();
    if (!src) return '';
    const alt = String(el.getAttribute('alt') || '').trim();
    return `![${alt}](${src})`;
  }

  const children = Array.from(el.childNodes).map(inlineHtmlToMarkdown).join('');

  if (tag === 'strong' || tag === 'b') return `**${children}**`;
  if (tag === 'em' || tag === 'i') return `*${children}*`;
  if (tag === 'u') return children; // Underline doesn't have markdown equivalent
  if (tag === 'sup') return `^${children}^`;
  if (tag === 'sub') return `~${children}~`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${children}~~`;
  if (tag === 'br') return '\n';

  return children;
}

/**
 * Convert markdown to HTML for TipTap consumption.
 * Handles: headings (##-####), bullet/ordered lists (nested), blockquotes, paragraphs
 */
function markdownToHtml(
  markdown: string,
  citationDisplayMeta?: PaperCitationDisplayMeta,
  figureDisplayMeta?: PaperFigureDisplayMeta
): string {
  const normalized = polishDraftMarkdown(normalizeLegacyCitationSpanMarkup(markdown || ''));
  if (!normalized) return '<p></p>';

  const lines = normalized.split('\n');
  const html: string[] = [];
  // Stack tracks open list tags to allow proper nesting
  const listStack: Array<'ul' | 'ol'> = [];
  let inParagraph = false;
  let inBlockquote = false;

  const closeParagraph = () => {
    if (inParagraph) {
      html.push('</p>');
      inParagraph = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push('</blockquote>');
      inBlockquote = false;
    }
  };

  const closeListsToLevel = (targetLevel: number) => {
    while (listStack.length > targetLevel) {
      html.push(`</${listStack.pop()!}>`);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) {
      closeParagraph();
      closeBlockquote();
      closeListsToLevel(0);
      continue;
    }

    // Headings: ## through ####
    const headingMatch = line.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      closeParagraph();
      closeBlockquote();
      closeListsToLevel(0);
      const level = Math.min(4, Math.max(2, headingMatch[1].length));
      html.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2].trim(), citationDisplayMeta, figureDisplayMeta)}</h${level}>`);
      continue;
    }

    // Blockquote: > text
    const blockquoteMatch = line.match(/^>\s*(.*)$/);
    if (blockquoteMatch) {
      closeParagraph();
      closeListsToLevel(0);
      if (!inBlockquote) {
        html.push('<blockquote>');
        inBlockquote = true;
      }
      const quoteContent = blockquoteMatch[1].trim();
      if (quoteContent) {
        html.push(`<p>${inlineMarkdownToHtml(quoteContent, citationDisplayMeta, figureDisplayMeta)}</p>`);
      }
      continue;
    }

    // List items: - bullet or 1. ordered (with nesting via indent)
    const listMatch = line.match(/^(\s*)(-|\d+\.)\s+(.+)$/);
    if (listMatch) {
      closeParagraph();
      closeBlockquote();
      const indentSpaces = (listMatch[1] || '').length;
      const level = Math.max(0, Math.floor(indentSpaces / 2));
      const listType: 'ul' | 'ol' = listMatch[2] === '-' ? 'ul' : 'ol';

      // Keep the current level open so ordered lists preserve counting across items.
      const targetDepth = level + 1;
      closeListsToLevel(targetDepth);

      // Open list layers until we reach the target level.
      while (listStack.length < targetDepth) {
        html.push(`<${listType}>`);
        listStack.push(listType);
      }

      if (listStack[level] !== listType) {
        // Different list type at same level - replace that branch.
        closeListsToLevel(level);
        while (listStack.length < targetDepth) {
          html.push(`<${listType}>`);
          listStack.push(listType);
        }
      }

      html.push(`<li>${inlineMarkdownToHtml(listMatch[3].trim(), citationDisplayMeta, figureDisplayMeta)}</li>`);
      continue;
    }

    // Plain text → paragraph
    closeListsToLevel(0);
    closeBlockquote();
    if (!inParagraph) {
      html.push('<p>');
      inParagraph = true;
    } else {
      html.push('<br/>');
    }
    html.push(inlineMarkdownToHtml(line, citationDisplayMeta, figureDisplayMeta));
  }

  closeParagraph();
  closeBlockquote();
  closeListsToLevel(0);
  return html.join('');
}

/**
 * Serialize a list element (ul/ol) back to markdown
 */
function serializeList(el: HTMLElement, level: number): string {
  const isOrdered = el.tagName.toLowerCase() === 'ol';
  const lines: string[] = [];
  let counter = 1;

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== 'li') continue;

    const nestedLists = Array.from(child.children).filter(
      c => c instanceof HTMLElement && (c.tagName.toLowerCase() === 'ul' || c.tagName.toLowerCase() === 'ol')
    ) as HTMLElement[];

    const inlineParts: string[] = [];
    for (const node of Array.from(child.childNodes)) {
      if (node instanceof HTMLElement && (node.tagName.toLowerCase() === 'ul' || node.tagName.toLowerCase() === 'ol')) {
        continue;
      }
      inlineParts.push(inlineHtmlToMarkdown(node));
    }

    const inlineText = inlineParts.join('').replace(/\s+/g, ' ').trim();
    if (inlineText) {
      const marker = isOrdered ? `${counter}.` : '-';
      lines.push(`${'  '.repeat(level)}${marker} ${inlineText}`);
      counter++;
    }

    for (const nested of nestedLists) {
      const nestedText = serializeList(nested, level + 1);
      if (nestedText.trim()) {
        lines.push(nestedText);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert TipTap HTML back to clean markdown
 */
function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const blocks: string[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) blocks.push(text);
      continue;
    }

    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const rawLevel = Number(tag.slice(1));
      // Clamp to ##..#### range for academic papers
      const level = rawLevel <= 2 ? 2 : rawLevel <= 4 ? rawLevel : 4;
      const text = Array.from(node.childNodes).map(inlineHtmlToMarkdown).join('').trim();
      blocks.push(`${'#'.repeat(level)} ${text}`);
      continue;
    }

    if (tag === 'p') {
      const inline = Array.from(node.childNodes).map(inlineHtmlToMarkdown).join('').replace(/\s+\n/g, '\n').trim();
      if (inline) blocks.push(inline);
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const list = serializeList(node, 0).trim();
      if (list) blocks.push(list);
      continue;
    }

    if (tag === 'blockquote') {
      // Recursively extract paragraphs inside blockquote
      const quoteLines: string[] = [];
      for (const child of Array.from(node.childNodes)) {
        // Use inlineHtmlToMarkdown for ALL child nodes so citation spans
        // inside blockquotes are preserved as [CITE:key].
        if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'p') {
          const text = Array.from(child.childNodes).map(inlineHtmlToMarkdown).join('').trim();
          if (text) quoteLines.push(`> ${text}`);
        } else {
          const text = inlineHtmlToMarkdown(child).trim();
          if (text) quoteLines.push(`> ${text}`);
        }
      }
      if (quoteLines.length > 0) blocks.push(quoteLines.join('\n'));
      continue;
    }

    // Fallback: use inlineHtmlToMarkdown so citation spans are not lost.
    const fallback = inlineHtmlToMarkdown(node).trim();
    if (fallback) blocks.push(fallback);
  }

  // Join blocks with double newline, then normalize via polishDraftMarkdown
  // but only for structural normalization, not heading promotion
  return polishDraftMarkdown(blocks.join('\n\n'));
}

// ============================================================================
// Toolbar Button
// ============================================================================

function MicroButton({
  onClick,
  active,
  disabled,
  title,
  children
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent focus theft so editor selection is preserved
        e.preventDefault();
      }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? 'bg-indigo-100 text-indigo-700'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

/** Thin divider between toolbar button groups */
function ToolbarSep() {
  return <div className="w-px h-4 bg-slate-200 mx-0.5" />;
}

// ============================================================================
// Custom CSS for academic paper styling inside TipTap
// ============================================================================

const EDITOR_STYLES = `
.paper-editor .ProseMirror {
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", serif;
  font-size: 11pt;
  line-height: 1.8;
  color: #1a1a2e;
  padding: 0.5rem 0.25rem;
  min-height: 2em;
  outline: none;
}

.paper-editor .ProseMirror p {
  margin-bottom: 0.6em;
  text-align: justify;
  text-indent: 0;
}

.paper-editor .ProseMirror p + p {
  text-indent: 1.5em;
}

.paper-editor .ProseMirror h2 {
  font-size: 13pt;
  font-weight: 700;
  margin-top: 1.8em;
  margin-bottom: 0.5em;
  color: #111827;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
  text-transform: none;
}

.paper-editor .ProseMirror h2:first-child {
  margin-top: 0;
}

.paper-editor .ProseMirror h3 {
  font-size: 12pt;
  font-weight: 600;
  margin-top: 1.4em;
  margin-bottom: 0.4em;
  color: #1f2937;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
  font-style: italic;
}

.paper-editor .ProseMirror h4 {
  font-size: 11pt;
  font-weight: 600;
  margin-top: 1.2em;
  margin-bottom: 0.3em;
  color: #374151;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
}

.paper-editor .ProseMirror ul {
  list-style-type: disc;
  padding-left: 1.8em;
  margin: 0.5em 0;
}

.paper-editor .ProseMirror ol {
  list-style-type: decimal;
  padding-left: 1.8em;
  margin: 0.5em 0;
}

.paper-editor .ProseMirror li {
  margin-bottom: 0.2em;
}

.paper-editor .ProseMirror li p {
  text-indent: 0;
  margin-bottom: 0.15em;
}

.paper-editor .ProseMirror blockquote {
  border-left: 3px solid #6366f1;
  padding-left: 1em;
  margin: 1em 0;
  color: #4b5563;
  font-style: italic;
}

.paper-editor .ProseMirror blockquote p {
  text-indent: 0;
}

.paper-editor .ProseMirror strong {
  font-weight: 700;
  color: #111827;
}

.paper-editor .ProseMirror em {
  font-style: italic;
}

.paper-editor .ProseMirror .paper-citation-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.8em;
  line-height: 1.3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-weight: 600;
  padding: 0.05em 0.45em;
  margin: 0 0.05em;
  white-space: nowrap;
}

.paper-editor .ProseMirror .paper-figure-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 0.25em;
  color: #1d4ed8;
  line-height: 1.3;
  padding: 0.05em 0.1em;
  margin: 0 0.05em;
  vertical-align: middle;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: #93c5fd;
  text-underline-offset: 0.12em;
}

.paper-editor .ProseMirror .paper-figure-chip-thumb {
  width: 1.8em;
  height: 1.8em;
  border-radius: 0.35em;
  border: 1px solid #cbd5e1;
  object-fit: cover;
  background: #ffffff;
  flex-shrink: 0;
}

.paper-editor .ProseMirror .paper-figure-chip-label {
  font-size: 0.8em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-weight: 600;
  white-space: nowrap;
}

.paper-editor .ProseMirror .paper-figure-chip:hover {
  color: #1d4ed8;
  text-decoration-color: #60a5fa;
}

.paper-editor .ProseMirror sup {
  font-size: 0.75em;
  vertical-align: super;
}

.paper-editor .ProseMirror sub {
  font-size: 0.75em;
  vertical-align: sub;
}
`;

// ============================================================================
// Main Component
// ============================================================================

const PaperMarkdownEditor = forwardRef<PaperMarkdownEditorRef, PaperMarkdownEditorProps>(function PaperMarkdownEditor(
  {
    value,
    onChange,
    onFocus,
    onBlur,
    onSelectionChange,
    onFigureClick,
    citationDisplayMeta,
    figureDisplayMeta,
    placeholder = 'Write section content...',
    disabled = false,
    className = ''
  },
  ref
) {
  const [hasFocus, setHasFocus] = useState(false);
  const lastMarkdownRef = useRef(polishDraftMarkdown(value || ''));
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const citationDisplayMetaRef = useRef<PaperCitationDisplayMeta | undefined>(citationDisplayMeta);
  const figureDisplayMetaRef = useRef<PaperFigureDisplayMeta | undefined>(figureDisplayMeta);
  const citationMetaSignature = citationDisplayMeta?.signature || '';
  const figureMetaSignature = figureDisplayMeta?.signature || '';
  // Guard: suppress onChange during programmatic setContent calls so that
  // a stale or partial HTML snapshot cannot overwrite lastMarkdownRef.
  const isProgrammaticUpdateRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialHtml = useMemo(() => markdownToHtml(value || '', citationDisplayMeta, figureDisplayMeta), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        blockquote: {},
        strike: {}
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Superscript,
      Subscript,
      Underline,
      CitationNode,
      FigureNode
    ],
    content: initialHtml,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none'
      }
    },
    onFocus: () => {
      setHasFocus(true);
      onFocus?.();
    },
    onBlur: () => {
      // Save selection on blur so external tools can restore it
      if (editor) {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          savedSelectionRef.current = { from, to };
        }
      }
      setHasFocus(false);
      onBlur?.();
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from === to) {
        onSelectionChange?.(null);
        return;
      }
      const text = ed.state.doc.textBetween(from, to, ' ').trim();
      onSelectionChange?.(text ? { text, start: from, end: to } : null);
    },
    onUpdate: ({ editor: ed }) => {
      // Skip if this update was triggered by a programmatic setContent call.
      // Some TipTap versions fire onUpdate even with emitUpdate: false.
      if (isProgrammaticUpdateRef.current) return;
      const markdown = htmlToMarkdown(ed.getHTML());
      lastMarkdownRef.current = markdown;
      onChange(markdown);
    }
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    citationDisplayMetaRef.current = citationDisplayMeta;
  }, [citationDisplayMeta]);

  useEffect(() => {
    figureDisplayMetaRef.current = figureDisplayMeta;
  }, [figureDisplayMeta]);

  useEffect(() => {
    if (!editor) return;
    const markdown = lastMarkdownRef.current || '';
    isProgrammaticUpdateRef.current = true;
    editor.commands.setContent(
      markdownToHtml(markdown, citationDisplayMetaRef.current, figureDisplayMetaRef.current),
      { emitUpdate: false }
    );
    isProgrammaticUpdateRef.current = false;
  }, [editor, citationMetaSignature, figureMetaSignature]);

  // Sync external value changes into the editor
  useEffect(() => {
    if (!editor) return;
    const normalized = polishDraftMarkdown(value || '');
    if (normalized === lastMarkdownRef.current) return;
    lastMarkdownRef.current = normalized;
    isProgrammaticUpdateRef.current = true;
    editor.commands.setContent(
      markdownToHtml(normalized, citationDisplayMetaRef.current, figureDisplayMetaRef.current),
      { emitUpdate: false }
    );
    isProgrammaticUpdateRef.current = false;
  }, [value, editor]);

  // Save/restore selection helpers for external consumers (e.g., FloatingWritingPanel)
  const saveSelection = useCallback((): { from: number; to: number } | null => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from === to) return savedSelectionRef.current;
    const range = { from, to };
    savedSelectionRef.current = range;
    return range;
  }, [editor]);

  const restoreSelection = useCallback((range: { from: number; to: number }) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(range).run();
  }, [editor]);

  const handleEditorClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (typeof onFigureClick !== 'function') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const figureElement = target?.closest('[data-figure-no]') as HTMLElement | null;
    if (!figureElement) return;

    const rawFigureNo = String(figureElement.getAttribute('data-figure-no') || '').trim();
    const figureNo = Number.parseInt(rawFigureNo, 10);
    if (!Number.isFinite(figureNo) || figureNo <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    onFigureClick(Math.trunc(figureNo));
  }, [onFigureClick]);

  const resolveInsertContent = useCallback((text: string): string => {
    return text;
  }, []);

  // Repair effect: convert plain-text [CITE:key]/[Figure N] markers left in
  // the editor DOM into structured atom nodes after raw-text insertion.
  useEffect(() => {
    if (!editor) return;
    const normalized = polishDraftMarkdown(value || '');
    const hasCitationMarker = /\[CITE:/i.test(normalized);
    const hasFigureMarker = FIGURE_MARKER_REGEX.test(normalized);
    if (!hasCitationMarker && !hasFigureMarker) return;
    const currentHtml = editor.getHTML();
    const citationInHtml = /\[CITE:/i.test(currentHtml);
    const figureInHtml = FIGURE_MARKER_REGEX.test(currentHtml);
    if (!citationInHtml && !figureInHtml) return;
    lastMarkdownRef.current = normalized;
    isProgrammaticUpdateRef.current = true;
    editor.commands.setContent(
      markdownToHtml(normalized, citationDisplayMetaRef.current, figureDisplayMetaRef.current),
      { emitUpdate: false }
    );
    isProgrammaticUpdateRef.current = false;
  }, [editor, value, citationMetaSignature, figureMetaSignature]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.chain().focus().run(),

      insertTextAtCursor: (text: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(resolveInsertContent(text)).run();
      },

      replaceSelection: (text: string) => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        const contentToInsert = resolveInsertContent(text);

        if (from !== to) {
          // Active selection exists - delete it and insert replacement
          editor.chain().focus().deleteSelection().insertContent(contentToInsert).run();
        } else if (savedSelectionRef.current) {
          // No active selection, but we have a saved one from before blur
          const saved = savedSelectionRef.current;
          editor.chain()
            .focus()
            .setTextSelection(saved)
            .deleteSelection()
            .insertContent(contentToInsert)
            .run();
          savedSelectionRef.current = null;
        } else {
          // Fallback: just insert at cursor
          editor.chain().focus().insertContent(contentToInsert).run();
        }
      },

      replaceRange: (from: number, to: number, text: string) => {
        if (!editor) return;
        editor.chain()
          .focus()
          .setTextSelection({ from, to })
          .deleteSelection()
          .insertContent(resolveInsertContent(text))
          .run();
      },

      getSelectedText: () => {
        if (!editor) return '';
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, ' ').trim();
      },

      getMarkdown: () => {
        if (!editor) return lastMarkdownRef.current || '';
        return htmlToMarkdown(editor.getHTML());
      },

      saveSelection,
      restoreSelection
    }),
    [editor, saveSelection, restoreSelection, resolveInsertContent]
  );

  const applyNormalFormatting = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .unsetAllMarks()
      .setParagraph()
      .setTextAlign('left')
      .run();
  }, [editor]);

  return (
    <div className={`paper-editor relative bg-white transition-all duration-150 ${hasFocus ? 'rounded-lg ring-1 ring-indigo-200/70 shadow-sm' : 'rounded-none border-transparent'} ${className}`}>
      {/* Inject editor styles */}
      <style>{EDITOR_STYLES}</style>

      {/* Sticky toolbar - visible when editor has focus */}
      {editor && hasFocus && (
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-100/80 px-2 py-1 rounded-t-lg flex items-center gap-0.5 flex-wrap">
          {/* Text formatting */}
          <MicroButton
            onClick={applyNormalFormatting}
            active={
              editor.isActive('paragraph')
              && !editor.isActive('bold')
              && !editor.isActive('italic')
              && !editor.isActive('underline')
              && !editor.isActive('strike')
              && !editor.isActive('superscript')
              && !editor.isActive('subscript')
            }
            title="Normal text (clear formatting)"
          >
            <span className="text-[10px] font-semibold">N</span>
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
            <Bold className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
            <Italic className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
            <SuperscriptIcon className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
            <SubscriptIcon className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Block formatting */}
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
            title="Section Heading (H2)"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
            title="Subsection Heading (H3)"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            active={editor.isActive('heading', { level: 4 })}
            title="Sub-subsection (H4)"
          >
            <Heading4 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive('paragraph')} title="Paragraph">
            <Pilcrow className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Lists & blocks */}
          <MicroButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
            <List className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
            <ListOrdered className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block Quote">
            <Quote className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Alignment */}
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            active={editor.isActive({ textAlign: 'left' })}
            title="Align Left"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            active={editor.isActive({ textAlign: 'center' })}
            title="Align Center"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            active={editor.isActive({ textAlign: 'justify' })}
            title="Justify"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Undo/Redo */}
          <MicroButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
            <Redo2 className="w-3.5 h-3.5" />
          </MicroButton>
        </div>
      )}

      {/* Bubble menu - appears on text selection for quick formatting */}
      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 px-1 py-0.5 shadow-xl backdrop-blur"
        >
          <MicroButton
            onClick={applyNormalFormatting}
            active={
              editor.isActive('paragraph')
              && !editor.isActive('bold')
              && !editor.isActive('italic')
              && !editor.isActive('underline')
              && !editor.isActive('strike')
              && !editor.isActive('superscript')
              && !editor.isActive('subscript')
            }
            title="Normal"
          >
            <span className="text-[10px] font-semibold">N</span>
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <Bold className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <Italic className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
            <UnderlineIcon className="w-3 h-3" />
          </MicroButton>
          <ToolbarSep />
          <MicroButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
            <SuperscriptIcon className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
            <SubscriptIcon className="w-3 h-3" />
          </MicroButton>
        </BubbleMenu>
      )}

      <div onClickCapture={handleEditorClickCapture}>
        <EditorContent editor={editor} />
      </div>
      {editor?.isEmpty && (
        <div className="pointer-events-none absolute left-2 top-10 text-slate-300 text-sm italic">
          {placeholder}
        </div>
      )}
    </div>
  );
});

export default PaperMarkdownEditor;
