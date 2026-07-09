import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BookOpen, Compass, Layers, LogOut, Search, Sparkles, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';

interface ResearcherWorkspaceShellProps {
  title: string;
  description: string;
  eyebrow: string;
  actions?: ReactNode;
  children: ReactNode;
}

const tabs = [
  { href: '/profile/researcher', label: 'Profile', icon: UserRound },
  { href: '/profile/research-fit', label: 'Research Fit', icon: Compass },
  { href: '/finder', label: 'Finder', icon: Search },
  { href: '/library', label: 'Reference Library', icon: BookOpen },
];

export default function ResearcherWorkspaceShell({
  title,
  description,
  eyebrow,
  actions,
  children,
}: ResearcherWorkspaceShellProps) {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f3f6f7] via-[#f1f6f4] to-[#eef4f1] text-slate-900">
      <Head>
        <title>{`${title} | GrantGenie`}</title>
        <meta name="description" content={description} />
      </Head>

      <header className="border-b border-slate-800/60 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.15)]">
              <Layers className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                <Sparkles className="h-3 w-3" />
                {eyebrow}
              </div>
              <div className="mt-0.5 truncate text-lg font-semibold text-white">{title}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              href="/finder"
              className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-200 sm:inline-flex"
            >
              <Search className="h-4 w-4" />
              Finder
            </Link>
            <Link
              href="/dashboard"
              className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/40 md:inline-flex"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-emerald-400 px-3.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <section className="pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">{eyebrow}</div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{title}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/85 px-4 py-3 text-sm shadow-sm">
              <div className="font-semibold text-slate-950">{user?.email || 'Researcher'}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Sparkles className="h-3 w-3 text-emerald-600" />
                Research intelligence workspace
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
            <nav
              aria-label="Workspace"
              className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-white/70 bg-white/85 p-1 shadow-sm"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = router.pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                      active
                        ? 'bg-slate-950 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-950'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-emerald-400' : ''}`} />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>

            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
        </section>

        <section>{children}</section>
      </main>
    </div>
  );
}
