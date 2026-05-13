'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'

import { useAuth } from '@/lib/auth-context'

const FUNDING_ADMIN_LINKS = [
  {
    href: '/super-admin/funding/imports',
    title: 'Cross-Tenant Review',
    description:
      'Inspect funding imports and call records across tenants before moving approved work into the shared catalog.',
    cta: 'Open review console',
  },
  {
    href: '/admin/funding/intake',
    title: 'Intake Approval Workspace',
    description:
      'Review extracted call data, guidelines, and templates. This is the approval workspace for tenant submissions.',
    cta: 'Open intake workspace',
  },
  {
    href: '/admin/funding/catalog',
    title: 'Publishing Catalog',
    description:
      'Publish vetted funding calls for all tenants, archive records, and keep the global catalog aligned with approvals.',
    cta: 'Open publish catalog',
  },
]

export default function SuperAdminFundingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isSuperAdmin = useMemo(
    () =>
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN_VIEWER') ||
      user?.platformPermissions?.includes('platform.support.read') ||
      user?.platformPermissions?.includes('funding.operations.write') ||
      user?.platformPermissions?.includes('funding.publisher.write'),
    [user?.platformPermissions, user?.roles]
  )

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    if (!isSuperAdmin) {
      router.replace('/dashboard')
    }
  }, [isLoading, isSuperAdmin, router, user])

  if (isLoading || !user || !isSuperAdmin) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-sm text-slate-600">Checking platform access...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Super Admin</div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Funding Control</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Tenant users can ingest funding calls, guidelines, and templates inside their own tenant workflows. Nothing
            becomes visible outside that tenant until a platform admin reviews the submission and publishes the approved
            call through the shared catalog.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {FUNDING_ADMIN_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Funding Admin</div>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p>
              <div className="mt-6 text-sm font-semibold text-slate-900 transition group-hover:text-sky-700">{item.cta}</div>
            </Link>
          ))}
        </div>

        <div className="rounded-3xl border border-sky-200 bg-sky-50 p-6 text-sm text-sky-950">
          Use the intake workspace for call normalization, guideline review, and template approval. Use the catalog
          workspace only after a call is ready to be published for all tenants.
        </div>
      </div>
    </div>
  )
}
