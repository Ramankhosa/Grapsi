'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowRight,
  Bot,
  ClipboardCheck,
  DatabaseZap,
  FileJson,
  Layers3,
  Library,
  ListChecks,
  Search,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type CallIngestionLink = {
  href: string
  title: string
  description: string
  cta: string
  icon: ComponentType<{ className?: string }>
  access: 'write' | 'read' | 'publish' | 'model' | 'super'
}

const CALL_INGESTION_LINKS: CallIngestionLink[] = [
  {
    href: '/admin/funding/intake#submit-intake-source',
    title: 'Single Call Intake',
    description: 'Submit one URL, pasted text block, PDF, or JSON extraction package.',
    cta: 'Open single intake',
    icon: Upload,
    access: 'write',
  },
  {
    href: '/admin/funding/intake#batch-composer',
    title: 'Batch Composer',
    description: 'Create multi-call batches with separate details, guideline, and template source slots.',
    cta: 'Open batch intake',
    icon: Layers3,
    access: 'write',
  },
  {
    href: '/admin/funding/intake#recent-batches',
    title: 'Batch Monitor',
    description: 'Track processing, review, failure, and draft-created counts for recent batches.',
    cta: 'View batches',
    icon: ListChecks,
    access: 'read',
  },
  {
    href: '/admin/funding/intake#recent-intake-jobs',
    title: 'Review Queue',
    description: 'Open individual intake jobs to resolve duplicates, complete fields, and run extract-all.',
    cta: 'Review jobs',
    icon: ClipboardCheck,
    access: 'read',
  },
  {
    href: '/super-admin/funding/imports',
    title: 'Cross-Tenant Imports',
    description: 'Inspect funding imports and tenant-private submissions before catalog approval.',
    cta: 'Open imports',
    icon: Search,
    access: 'read',
  },
  {
    href: '/admin/funding/catalog',
    title: 'Catalog Publishing',
    description: 'Publish, archive, reject, and maintain approved global funding calls.',
    cta: 'Open catalog',
    icon: Library,
    access: 'publish',
  },
  {
    href: '/super-admin/research-areas',
    title: 'Research Taxonomy',
    description: 'Upload and maintain funding research-area taxonomy used by call discovery and tagging.',
    cta: 'Manage taxonomy',
    icon: DatabaseZap,
    access: 'write',
  },
  {
    href: '/super-admin/llm-config',
    title: 'LLM Stage Settings',
    description: 'Tune funding ingestion, chat, guideline, and template extraction model stages.',
    cta: 'Configure models',
    icon: Bot,
    access: 'model',
  },
  {
    href: '/super-admin/team-roles',
    title: 'Call Ingestion Operators',
    description: 'Assign platform funding roles such as Funding Operations Manager and Funding Publisher.',
    cta: 'Manage operators',
    icon: Users,
    access: 'super',
  },
  {
    href: '/admin/funding/intake#submit-intake-source',
    title: 'JSON Extraction Package',
    description: 'Use the JSON upload path when call details, guidelines, and templates were prepared externally.',
    cta: 'Upload JSON',
    icon: FileJson,
    access: 'write',
  },
]

function hasAnyPermission(user: any, permissions: string[]) {
  const userPermissions = user?.platformPermissions || []
  return permissions.some((permission) => userPermissions.includes(permission))
}

function canUseLink(user: any, access: CallIngestionLink['access']) {
  const roles = user?.roles || []
  const isPlatformAdmin = roles.includes('ADMIN') && user?.ati_id === 'PLATFORM'
  if (roles.includes('SUPER_ADMIN')) {
    return true
  }

  if (access === 'read') {
    return (
      roles.includes('SUPER_ADMIN_VIEWER') ||
      isPlatformAdmin ||
      hasAnyPermission(user, ['platform.support.read', 'funding.operations.write', 'funding.publisher.write'])
    )
  }

  if (access === 'write') {
    return isPlatformAdmin || hasAnyPermission(user, ['funding.operations.write'])
  }

  if (access === 'publish') {
    return isPlatformAdmin || hasAnyPermission(user, ['funding.publisher.write'])
  }

  if (access === 'model') {
    return hasAnyPermission(user, ['ai.model.manage'])
  }

  return false
}

export default function SuperAdminFundingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isPlatformAdmin = Boolean(user?.roles?.includes('ADMIN') && user?.ati_id === 'PLATFORM')
  const canAccessFundingControl = useMemo(
    () =>
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN_VIEWER') ||
      isPlatformAdmin ||
      hasAnyPermission(user, [
        'platform.support.read',
        'funding.operations.write',
        'funding.publisher.write',
        'ai.model.manage',
      ]),
    [isPlatformAdmin, user]
  )
  const canWriteIntake = Boolean(
    user?.roles?.includes('SUPER_ADMIN') || isPlatformAdmin || hasAnyPermission(user, ['funding.operations.write'])
  )
  const canPublish = Boolean(
    user?.roles?.includes('SUPER_ADMIN') || isPlatformAdmin || hasAnyPermission(user, ['funding.publisher.write'])
  )
  const canTuneModels = Boolean(user?.roles?.includes('SUPER_ADMIN') || hasAnyPermission(user, ['ai.model.manage']))

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    if (!canAccessFundingControl) {
      router.replace('/dashboard')
    }
  }, [canAccessFundingControl, isLoading, router, user])

  if (isLoading || !user || !canAccessFundingControl) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-sm text-slate-600">Checking platform access...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Super Admin</div>
              <h1 className="mt-3 text-3xl font-semibold text-slate-950">Call Ingestion Control</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                One place for funding call intake, batch processing, review queues, catalog publishing, taxonomy, and
                model-stage controls. Operational users see the ingestion tools they can use; Super Admin sees every
                control surface.
              </p>
            </div>
            <Link
              href="/admin/funding/intake#batch-composer"
              className="inline-flex items-center gap-2 bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Batch composer
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Ingestion Access</h2>
            </div>
            <div className="mt-4 text-2xl font-semibold text-slate-950">{canWriteIntake ? 'Enabled' : 'Read only'}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">URL, text, PDF, JSON, source-slot mapping, retries, and batch creation.</p>
          </div>
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Library className="h-5 w-5 text-sky-700" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Publishing</h2>
            </div>
            <div className="mt-4 text-2xl font-semibold text-slate-950">{canPublish ? 'Enabled' : 'Separate role'}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">Catalog publish, archive, and reject actions stay separate from ingestion work.</p>
          </div>
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-violet-700" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">LLM Controls</h2>
            </div>
            <div className="mt-4 text-2xl font-semibold text-slate-950">{canTuneModels ? 'Enabled' : 'Configured by admin'}</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">Funding stage routing for call, chat, guideline, and template extraction.</p>
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Call Ingestion Options</h2>
              <p className="mt-1 text-sm text-slate-600">Direct links into every current call-ingestion workflow and related control surface.</p>
            </div>
            <Link href="/admin/funding/intake" className="text-sm font-semibold text-slate-800 hover:text-sky-700">
              Open full intake workspace
            </Link>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CALL_INGESTION_LINKS.map((item) => {
              const Icon = item.icon
              const enabled = canUseLink(user, item.access)
              return (
                <Link
                  key={`${item.href}-${item.title}`}
                  href={enabled ? item.href : '/super-admin/funding'}
                  aria-disabled={!enabled}
                  className={`group border p-5 shadow-sm transition ${
                    enabled
                      ? 'border-slate-200 bg-white hover:border-slate-400 hover:shadow-md'
                      : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <Icon className="h-5 w-5 text-slate-700" />
                    {!enabled && (
                      <span className="bg-slate-200 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                        Restricted
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-950">{item.title}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{item.description}</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 group-hover:text-sky-700">
                    {item.cta}
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="border border-sky-200 bg-sky-50 p-5 text-sm leading-6 text-sky-950">
          Batch intake is async and DB-backed. Use the batch composer for multiple calls, then use the review queue to
          resolve `needs_review` jobs before publishing vetted drafts from the catalog.
        </section>
      </div>
    </div>
  )
}
