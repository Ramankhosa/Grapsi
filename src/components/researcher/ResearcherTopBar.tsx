import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Bell,
  BookOpen,
  ClipboardList,
  Compass,
  LayoutGrid,
  Lightbulb,
  LogOut,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

// App Router destinations (/assignments, /funding/intelligence, …) never read
// as "active" here — this bar only mounts on Pages Router pages, so
// router.pathname can never equal them. That is fine: the tab still navigates.
const tabs = [
  { href: '/profile/researcher', label: 'Profile', icon: UserRound },
  { href: '/profile/research-fit', label: 'Research Fit', icon: Compass },
  { href: '/finder', label: 'Finder', icon: Search },
  { href: '/assignments', label: 'Assignments', icon: ClipboardList },
  { href: '/reviewer', label: 'Reviewer', icon: ShieldCheck },
  { href: '/funding/intelligence', label: 'Intelligence', icon: Lightbulb },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/library', label: 'Library', icon: BookOpen },
];

/**
 * The single sticky chrome for the researcher workspace: brand, section tabs, and
 * account controls. On phones the tab rail scrolls horizontally instead of wrapping.
 */
export default function ResearcherTopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const initial = user?.email?.charAt(0)?.toUpperCase() || 'R';

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-ground/95 backdrop-blur">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cobalt-600 text-white">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">GrantGenie</span>
          </Link>

          <div className="flex shrink-0 items-center gap-1.5">
            <Link href="/dashboard" className="cb-btn cb-btn-sm hidden text-muted hover:bg-inset hover:text-ink sm:inline-flex">
              Dashboard
            </Link>
            <span className="hidden max-w-[200px] truncate text-[13px] text-muted lg:inline">{user?.email}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-inset text-[13px] font-semibold text-ink-soft">
              {initial}
            </span>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              title="Sign out"
              className="cb-btn-ghost cb-btn-sm px-2"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav aria-label="Workspace" className="cb-scroll-x -mx-1 flex gap-1 px-1 pb-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = router.pathname === tab.href || router.pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`cb-tab ${active ? 'cb-tab-active' : ''}`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
