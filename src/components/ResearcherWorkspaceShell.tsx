import Head from 'next/head';
import type { ReactNode } from 'react';
import ResearcherTopBar from '@/components/researcher/ResearcherTopBar';

interface ResearcherWorkspaceShellProps {
  title: string;
  description: string;
  eyebrow: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function ResearcherWorkspaceShell({
  title,
  description,
  eyebrow,
  actions,
  children,
}: ResearcherWorkspaceShellProps) {
  return (
    <div className="cb-page min-h-screen bg-inset text-ink">
      <Head>
        <title>{`${title} | GrantGenie`}</title>
        <meta name="description" content={description} />
      </Head>

      <ResearcherTopBar />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="cb-eyebrow">{eyebrow}</div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>

        {children}
      </main>
    </div>
  );
}
