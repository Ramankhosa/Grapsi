'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import {
  ArrowRight,
  Compass,
  FileText,
  LayoutDashboard,
  Search,
  ShieldCheck,
  UserCircle
} from 'lucide-react'

const productOptions = [
  {
    title: 'Fund Finder',
    description: 'Open the funding directory and the Fund Finder AI chatbot.',
    href: '/finder',
    icon: Search,
    accent: 'emerald'
  },
  {
    title: 'GrantWriter',
    description: 'Go to your projects workspace to build and manage grant applications.',
    href: '/projects',
    icon: FileText,
    accent: 'sky'
  },
  {
    title: 'Researcher Profile',
    description: 'Provide your profile and eligibility details so funding discovery can personalize results.',
    href: '/profile/researcher',
    icon: UserCircle,
    accent: 'amber'
  }
] as const

function getAccentClasses(accent: 'emerald' | 'sky' | 'amber' | 'violet') {
  if (accent === 'emerald') {
    return {
      iconWrap: 'bg-emerald-100 text-emerald-700',
      border: 'border-emerald-200 hover:border-emerald-300',
      glow: 'from-emerald-100 via-white to-teal-50',
      link: 'text-emerald-700'
    }
  }

  if (accent === 'amber') {
    return {
      iconWrap: 'bg-amber-100 text-amber-700',
      border: 'border-amber-200 hover:border-amber-300',
      glow: 'from-amber-100 via-white to-orange-50',
      link: 'text-amber-700'
    }
  }

  if (accent === 'violet') {
    return {
      iconWrap: 'bg-violet-100 text-violet-700',
      border: 'border-violet-200 hover:border-violet-300',
      glow: 'from-violet-100 via-white to-fuchsia-50',
      link: 'text-violet-700'
    }
  }

  return {
    iconWrap: 'bg-sky-100 text-sky-700',
    border: 'border-sky-200 hover:border-sky-300',
    glow: 'from-sky-100 via-white to-cyan-50',
    link: 'text-sky-700'
  }
}

export default function UserProductChooser() {
  const { user } = useAuth()
  const emailPrefix = user?.email?.split('@')[0]

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.12),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)]">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[32px] border border-slate-200 bg-white/90 p-8 shadow-[0_32px_80px_-36px_rgba(15,23,42,0.35)] backdrop-blur sm:p-10">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600">
                Choose your workspace
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                What do you want to work on{emailPrefix ? `, ${emailPrefix}` : ''}?
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                Start in the product you need right now. You can come back here after login any time.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {productOptions.map((option) => {
                const Icon = option.icon
                const accentClasses = getAccentClasses(option.accent)

                return (
                  <Link
                    key={option.title}
                    href={option.href}
                    className={`group flex h-full flex-col rounded-3xl border bg-gradient-to-br ${accentClasses.glow} p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${accentClasses.border}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${accentClasses.iconWrap}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <ArrowRight className={`h-5 w-5 transition-transform duration-200 group-hover:translate-x-1 ${accentClasses.link}`} />
                    </div>
                    <div className="mt-6">
                      <h2 className="text-2xl font-semibold text-slate-950">{option.title}</h2>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{option.description}</p>
                    </div>
                    <div className={`mt-8 inline-flex items-center text-sm font-semibold ${accentClasses.link}`}>
                      Open {option.title}
                    </div>
                  </Link>
                )
              })}

              <Link
                href="/profile/research-areas"
                className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <Compass className="h-6 w-6" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-500 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-emerald-700" />
                </div>
                <div className="mt-6">
                  <h2 className="text-2xl font-semibold text-slate-950">Research Areas</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Save keywords and focus areas so the finder can anchor recommendations to your work.
                  </p>
                </div>
                <div className="mt-8 inline-flex items-center text-sm font-semibold text-slate-700 group-hover:text-emerald-700">
                  Open Research Areas
                </div>
              </Link>

              <Link
                href="/reviewer"
                className="group flex h-full flex-col rounded-3xl border bg-gradient-to-br from-violet-100 via-white to-fuchsia-50 p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl border-violet-200 hover:border-violet-300 md:col-span-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-violet-700 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
                <div className="mt-6">
                  <h2 className="text-2xl font-semibold text-slate-950">Grant Reviewer</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Run structured section reviews, context summaries, revisions, and generate a final review report.
                  </p>
                </div>
                <div className="mt-8 inline-flex w-fit items-center text-sm font-semibold text-violet-700">
                  Open Grant Reviewer
                </div>
              </Link>
            </div>
          </section>

          <aside className="flex flex-col justify-between rounded-[32px] border border-slate-200 bg-slate-950 p-8 text-slate-50 shadow-[0_32px_80px_-36px_rgba(15,23,42,0.55)] sm:p-10">
            <div>
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-slate-200">
                Existing workspace
              </div>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight">
                Need the classic dashboard?
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                Your current paper-writing and funding widgets still exist. Open the workspace directly if you want the previous layout.
              </p>
            </div>

            <div className="mt-10 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                    <LayoutDashboard className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Open workspace dashboard</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Continue using the original dashboard with recent papers, quick actions, and funding tools.
                    </p>
                  </div>
                </div>
              </div>

              <Link
                href="/dashboard/workspace"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-200"
              >
                Go to workspace dashboard
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
