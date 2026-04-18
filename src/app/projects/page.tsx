import { Suspense } from 'react'

import ProjectsPageClient from './ProjectsPageClient'

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          Loading your projects...
        </div>
      }
    >
      <ProjectsPageClient />
    </Suspense>
  )
}
