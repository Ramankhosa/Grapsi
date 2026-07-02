import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaBookOpen, FaCompass, FaLayerGroup, FaSearch, FaSignOutAlt, FaUserCircle } from 'react-icons/fa';
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
  { href: '/profile/researcher', label: 'Profile', icon: FaUserCircle },
  { href: '/profile/research-fit', label: 'Research Fit', icon: FaCompass },
  { href: '/finder', label: 'Finder', icon: FaSearch },
  { href: '/library', label: 'Advanced reference library', icon: FaBookOpen },
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
    <div className="min-h-screen bg-[#f3f6f7] text-slate-900">
      <Head>
        <title>{`${title} | GrantGenie`}</title>
        <meta name="description" content={description} />
      </Head>

      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/30 bg-slate-900 text-cyan-300">
              <FaLayerGroup />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase text-cyan-300">{eyebrow}</div>
              <div className="mt-1 text-lg font-semibold text-white">{title}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/finder" className="hidden items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-500 hover:text-cyan-200 sm:inline-flex">
              <FaSearch />
              Finder
            </Link>
            <Link href="/dashboard" className="hidden items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 md:inline-flex">
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-400 px-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              <FaSignOutAlt />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <section className="border-b border-slate-300 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-[11px] font-semibold uppercase text-cyan-700">{eyebrow}</div>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">{title}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
            </div>
            <div className="border-l-2 border-lime-500 bg-white px-4 py-3 text-sm shadow-sm">
              <div className="font-semibold text-slate-950">{user?.email || 'Researcher'}</div>
              <div className="mt-1 text-xs text-slate-500">Research intelligence workspace</div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                      router.pathname === tab.href
                        ? 'border-slate-950 bg-slate-950 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-cyan-500 hover:text-cyan-800'
                    }`}
                  >
                    <Icon />
                    {tab.label}
                  </Link>
                );
              })}
            </div>

            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>
        </section>

        <section className="mt-6">{children}</section>
      </main>
    </div>
  );
}
