import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FinderMarkdownProps {
  content: string;
  inverted?: boolean;
}

/**
 * Markdown renderer for finder chat messages. No Tailwind typography plugin exists in
 * this project, so every element is styled through the components map. Legacy messages
 * were plain text relying on raw newlines — single newlines are promoted to hard breaks
 * so they keep rendering correctly.
 */
export default function FinderMarkdown({ content, inverted = false }: FinderMarkdownProps) {
  const prepared = content.replace(/\n/g, '  \n');
  const strongClass = inverted ? 'font-semibold text-white' : 'font-semibold text-ink';
  const linkClass = inverted
    ? 'font-medium text-white underline underline-offset-2 hover:text-cobalt-100'
    : 'font-medium text-cobalt-700 underline underline-offset-2 hover:text-cobalt-800';

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-1.5 leading-7 first:mt-0 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className={strongClass}>{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className={`rounded px-1.5 py-0.5 text-[0.85em] ${inverted ? 'bg-white/15 text-white' : 'bg-inset text-ink-soft'}`}>
            {children}
          </code>
        ),
        // Headings and tables are prompt-discouraged; render them as plain emphasis if a
        // model emits one anyway, instead of blowing up the bubble layout.
        h1: ({ children }) => <p className={`my-2 text-sm ${strongClass}`}>{children}</p>,
        h2: ({ children }) => <p className={`my-2 text-sm ${strongClass}`}>{children}</p>,
        h3: ({ children }) => <p className={`my-2 text-sm ${strongClass}`}>{children}</p>,
        blockquote: ({ children }) => (
          <blockquote className={`my-2 border-l-2 pl-3 ${inverted ? 'border-white/30' : 'border-cobalt-200'}`}>{children}</blockquote>
        ),
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}
