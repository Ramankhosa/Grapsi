import { Suspense } from 'react'

import ExplorerPage from '@/components/funding-intelligence/ExplorerPage'

export const metadata = {
  title: 'Funding Intelligence | Paper Nest',
  description: 'Search awarded research and position your next idea with funding evidence.',
}

export default function FundingIntelligencePage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] bg-[#f6f8f7] p-8 text-sm text-slate-500">Loading funding intelligence...</div>}>
      <ExplorerPage />
    </Suspense>
  )
}
