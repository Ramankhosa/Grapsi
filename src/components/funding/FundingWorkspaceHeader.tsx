'use client'

import Link from 'next/link'
import { ArrowUpRight, ClipboardList, Compass, Layers3, Lightbulb, Search, Star } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

type Section = 'discovery' | 'intelligence' | 'idea' | 'dsr' | 'personal'

/** Shared orientation across the funding journey; each destination retains its own access checks. */
export default function FundingWorkspaceHeader({ section, title, description, actions }: {
  section: Section; title: string; description: string; actions?: ReactNode
}) {
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const container = nav.current
    const orient = () => {
      const active = container?.querySelector<HTMLElement>('[aria-current="page"]')
      if (active && container) container.scrollLeft = active.offsetLeft - container.offsetLeft - (container.clientWidth - active.clientWidth) / 2
    }
    orient()
    const observer = new ResizeObserver(orient)
    if (container) observer.observe(container)
    return () => observer.disconnect()
  }, [section])
  return <header className="funding-header">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white"><Compass className="h-5 w-5" aria-hidden="true" /></span>
        Funding workspace
      </div>
      <nav ref={nav} aria-label="Funding workspace" className="flex max-w-full flex-nowrap gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1">
        {([
          ['discovery', '/finder', 'Discover funding', Search],
          ['intelligence', '/funding/intelligence', 'Research intelligence', Layers3],
          ['idea', '/funding/intelligence/idea/new', 'Explore an idea', Lightbulb],
          ['personal', '/funding/my-grants', 'My grants', Star],
        ] as const).map(([key, href, label, Icon]) => <Link key={key} href={href} aria-current={section === key ? 'page' : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition ${section === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" /><span>{label}</span>
        </Link>)}
        {section === 'dsr' && <Link href="/funding-dept/reports" aria-current="page" className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-blue-50 px-3 text-sm font-medium text-blue-700"><ClipboardList className="h-4 w-4" aria-hidden="true" />DSR workspace</Link>}
      </nav>
    </div>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4 sm:mt-8 sm:gap-5">
      <div className="max-w-3xl"><h1 className="text-[26px] font-semibold leading-tight tracking-[-0.035em] text-slate-950 sm:text-[38px]">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">{description}</p></div>
      {actions && <div className={`${section === 'discovery' ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-2`}>{actions}</div>}
    </div>
  </header>
}

export function FundingWorkspaceLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="funding-button-secondary">{children}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
}
