import Head from 'next/head';
import Link from 'next/link';
import { FaBell, FaCompass, FaLayerGroup, FaSearch, FaSignOutAlt, FaUserCircle } from 'react-icons/fa';
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
  { href: '/profile/researcher', label: 'Researcher Profile', icon: FaUserCircle },
  { href: '/profile/research-areas', label: 'Research Areas', icon: FaCompass },
];

export default function ResearcherWorkspaceShell({
  title,
  description,
  eyebrow,
  actions,
  children,
}: ResearcherWorkspaceShellProps) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.14),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f3_52%,_#ffffff_100%)] text-slate-900">
      <Head>
        <title>{title} | GrantGenie</title>
        <meta name="description" content={description} />
      </Head>

      <header className="border-b border-white/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-emerald-300 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
              <FaLayerGroup />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">{eyebrow}</div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{title}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/finder" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800">
              <FaSearch />
              Finder
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300">
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              <FaSignOutAlt />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-[30px] border border-white/80 bg-white/80 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">{eyebrow}</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
              <p className="mt-4 text-base leading-7 text-slate-600">{description}</p>
            </div>
            <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 px-5 py-4 text-sm text-emerald-950">
              <div className="font-semibold">{user?.email || 'Researcher'}</div>
              <div className="mt-1 text-emerald-800">Keep your research identity, alert preferences, and reusable search inputs in one place.</div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-3">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    <Icon />
                    {tab.label}
                  </Link>
                );
              })}
              <Link
                href="/finder"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              >
                <FaBell />
                Use in Finder
              </Link>
            </div>

            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </section>

        <section className="mt-8">{children}</section>
      </main>
    </div>
  );
}
