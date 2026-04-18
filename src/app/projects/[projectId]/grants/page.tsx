import { Suspense } from 'react'

import ProjectGrantsPageClient from './ProjectGrantsPageClient'

export default function ProjectGrantsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          Loading grant sessions...
        </div>
      }
    >
      <ProjectGrantsPageClient />
    </Suspense>
  )
}
