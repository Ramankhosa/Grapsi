import { Suspense } from 'react'

import NewIdeaAnalysisPage from '@/components/funding-intelligence/NewIdeaAnalysisPage'

export default function NewIdeaIntelligencePage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] bg-[#f5f8f7] p-8 text-sm text-slate-500">Loading idea workspace…</div>}>
      <NewIdeaAnalysisPage />
    </Suspense>
  )
}
