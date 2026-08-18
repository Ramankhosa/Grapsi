import { Suspense } from 'react'

import FeatureGate from '@/components/access/FeatureGate'
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
      <FeatureGate module="GRANT_STUDIO" title="Grant Studio is not included in your plan">
        <ProjectsPageClient />
      </FeatureGate>
    </Suspense>
  )
}
