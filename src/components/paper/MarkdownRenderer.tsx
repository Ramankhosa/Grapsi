'use client';

import { useMemo } from 'react';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';
import type { PaperFigureDisplayMeta } from './PaperMarkdownEditor';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  figureDisplayMeta?: PaperFigureDisplayMeta;
  onFigureClick?: (figureNo: number) => void;
}

type ParsedListLine = {
  type: 'ul' | 'ol';
  level: number;
  text: string;
};

type ListNode = {
  type: 'ul' | 'ol';
  text: string;
  children: ListNode[];
};

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ParsedListLine[] }
  | { kind: 'blockquote'; lines: string[] };

function parseListLine(line: string): ParsedListLine | null {
  const unordered = line.match(/^(\s*)-\s+(.+)$/);
  if (unordered) {
    return {
      type: 'ul',
      level: Math.max(0, Math.floor((unordered[1] || '').length / 2)),
      text: unordered[2].trim()
    };
  }

  const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (ordered) {
    return {
      type: 'ol',
      level: Math.max(0, Math.floor((ordered[1] || '').length / 2)),
      text: ordered[3].trim()
    };
  }

  return null;
}

function parseMarkdownBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = (lines[index] || '').replace(/\s+$/g, '');
    if (!line.trim()) {
      index++;
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim()
      });
      index++;
      continue;
    }

    // Blockquote: > text
    const blockquoteMatch = line.match(/^>\s*(.*)$/);
    if (blockquoteMatch) {
      const quoteLines: string[] = [blockquoteMatch[1].trim()];
      index++;
      while (index < lines.length) {
        const current = (lines[index] || '').replace(/\s+$/g, '');
        const nextBq = current.match(/^>\s*(.*)$/);
        if (nextBq) {
          quoteLines.push(nextBq[1].trim());
          index++;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'blockquote', lines: quoteLines.filter(Boolean) });
      continue;
    }

    const firstListLine = parseListLine(line);
    if (firstListLine) {
      const listItems: ParsedListLine[] = [firstListLine];
      index++;

      while (index < lines.length) {
        const current = (lines[index] || '').replace(/\s+$/g, '');
        if (!current.trim()) {
          index++;
          continue;
        }

        const parsed = parseListLine(current);
        if (parsed) {
          listItems.push(parsed);
          index++;
          continue;
        }

        if (/^\s{2,}\S/.test(current) && listItems.length > 0) {
          listItems[listItems.length - 1].text += ` ${current.trim()}`;
          index++;
          continue;
        }

        break;
      }

      blocks.push({ kind: 'list', items: listItems });
      continue;
    }

    const paragraphLines: string[] = [line.trim()];
    index++;

    while (index < lines.length) {
      const current = (lines[index] || '').replace(/\s+$/g, '');
      if (!current.trim()) break;
      if (/^(#{2,4})\s+/.test(current)) break;
      if (parseListLine(current)) break;
      paragraphLines.push(current.trim());
      index++;
    }

    blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function buildListTree(items: ParsedListLine[]): ListNode[] {
  if (!items.length) return [];

  const minLevel = Math.min(...items.map(item => item.level));
  const normalized = items.map(item => ({ ...item, level: item.level - minLevel }));
  const roots: ListNode[] = [];
  const stack: Array<{ level: number; node: ListNode }> = [];

  for (const item of normalized) {
    const node: ListNode = {
      type: item.type,
      text: item.text,
      children: []
    };

    while (stack.length > 0 && item.level <= stack[stack.length - 1].level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ level: item.level, node });
  }

  return roots;
}

function renderFigureInline(
  figureNo: number,
  figureDisplayMeta?: PaperFigureDisplayMeta,
  onFigureClick?: (figureNo: number) => void
): React.ReactNode {
  const meta = figureDisplayMeta?.byNo?.[figureNo];
  const title = typeof meta?.title === 'string' ? meta.title.trim() : '';
  const label = `[Figure ${figureNo}]`;
  const clickable = typeof onFigureClick === 'function';

  return (
    <button
      type="button"
      className={`inline border-0 bg-transparent p-0 px-0.5 text-sm font-mono ${clickable ? 'cursor-pointer text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-700' : 'text-blue-600'}`}
      title={title ? `Figure ${figureNo}: ${title}` : `Figure ${figureNo}`}
      onClick={clickable ? () => onFigureClick(figureNo) : undefined}
    >
      {label}
    </button>
  );
}

function renderListGroups(
  nodes: ListNode[],
  depth: number = 0,
  figureDisplayMeta?: PaperFigureDisplayMeta,
  onFigureClick?: (figureNo: number) => void
): React.ReactNode {
  if (!nodes.length) return null;

  const groups: Array<{ type: 'ul' | 'ol'; nodes: ListNode[] }> = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (!last || last.type !== node.type) {
      groups.push({ type: node.type, nodes: [node] });
    } else {
      last.nodes.push(node);
    }
  }

  return groups.map((group, groupIndex) => {
    const isUnordered = group.type === 'ul';
    const ListTag = isUnordered ? 'ul' : 'ol';
    const markerClass = isUnordered ? 'list-disc' : 'list-decimal';
    const marginClass = depth === 0 ? 'ml-6' : 'ml-5';

    return (
      <ListTag
        key={`${depth}-${groupIndex}`}
        className={`${markerClass} list-outside ${marginClass} my-2 space-y-1`}
        style={{ fontSize: '11pt' }}
      >
        {group.nodes.map((node, nodeIndex) => (
          <li key={`${depth}-${groupIndex}-${nodeIndex}`} className="text-gray-800 pl-1">
            {formatInlineText(node.text, figureDisplayMeta, onFigureClick)}
            {node.children.length > 0 && renderListGroups(node.children, depth + 1, figureDisplayMeta, onFigureClick)}
          </li>
        ))}
      </ListTag>
    );
  });
}

export default function MarkdownRenderer({ content, className = '', figureDisplayMeta, onFigureClick }: MarkdownRendererProps) {
  const rendered = useMemo(() => {
    const normalized = polishDraftMarkdown(content || '');
    if (!normalized) return null;

    const blocks = parseMarkdownBlocks(normalized);

    return blocks.map((block, index) => {
      if (block.kind === 'heading') {
        if (block.level <= 2) {
          return (
            <h3
              key={index}
              className="text-gray-900 mt-8 mb-3 first:mt-0"
              style={{
                fontSize: '13pt',
                fontWeight: 700,
                fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif'
              }}
            >
              {formatInlineText(block.text, figureDisplayMeta, onFigureClick)}
            </h3>
          );
        }

        return (
          <h4
            key={index}
            className="text-gray-900 mt-6 mb-2 first:mt-0"
            style={{
              fontSize: '12pt',
              fontWeight: 600,
              fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif'
              }}
            >
            {formatInlineText(block.text, figureDisplayMeta, onFigureClick)}
          </h4>
        );
      }

      if (block.kind === 'blockquote') {
        return (
          <blockquote
            key={index}
            className="border-l-3 border-indigo-400 pl-4 my-4 text-gray-600 italic"
            style={{ fontSize: '10.5pt', lineHeight: '1.6' }}
          >
            {block.lines.map((line, i) => (
              <p key={i} className="my-1">{formatInlineText(line, figureDisplayMeta, onFigureClick)}</p>
            ))}
          </blockquote>
        );
      }

      if (block.kind === 'list') {
        const tree = buildListTree(block.items);
        return (
          <div key={index} className="my-2">
            {renderListGroups(tree, 0, figureDisplayMeta, onFigureClick)}
          </div>
        );
      }

      return (
        <p
          key={index}
          className="text-gray-800 my-3 text-justify first:mt-0"
          style={{
            textIndent: '1.5em',
            marginBottom: '0.8em'
          }}
        >
          {formatInlineText(block.text, figureDisplayMeta, onFigureClick)}
        </p>
      );
    });
  }, [content, figureDisplayMeta, onFigureClick]);

  return (
    <div 
      className={`prose prose-slate max-w-none ${className}`}
      style={{ 
        fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Times, Georgia, serif',
        fontSize: '11pt',
        lineHeight: '1.6'
      }}
    >
      {rendered}
    </div>
  );
}

/**
 * Format inline text (bold, italic, citations)
 */
function formatInlineText(
  text: string,
  figureDisplayMeta?: PaperFigureDisplayMeta,
  onFigureClick?: (figureNo: number) => void
): React.ReactNode {
  if (!text) return text;

  // Pattern to match bold, italic, and citations
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // Combined regex for **bold**, *italic*, and [CITE:key]
  const inlinePattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\[CITE:([^\]]+)\])|(\[Figure\s+(\d+)\])/g;
  let match;

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold **text**
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-900">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Italic *text*
      parts.push(
        <em key={match.index} className="italic">
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      // Citation [CITE:key]
      parts.push(
        <span key={match.index} className="text-blue-600 bg-blue-50 px-1 rounded text-sm font-mono">
          [{match[6]}]
        </span>
      );
    } else if (match[7]) {
      // Figure reference [Figure N]
      const figureNo = Number.parseInt(match[8], 10);
      parts.push(
        <span key={match.index}>
          {Number.isFinite(figureNo) && figureNo > 0
            ? renderFigureInline(figureNo, figureDisplayMeta, onFigureClick)
            : `[Figure ${match[8]}]`}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

