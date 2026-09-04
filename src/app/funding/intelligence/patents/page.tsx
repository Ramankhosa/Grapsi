import { Suspense } from 'react'

import PatentSearchPage from '@/components/funding-intelligence/patents/PatentSearchPage'

export const metadata = {
  title: 'Patent Search | Funding Intelligence',
  description: 'Search related patents by meaning and build a prior-art shortlist you can cite in your proposal.',
}

export default function FundingIntelligencePatentsPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] bg-[#f6f8f7] p-8 text-sm text-slate-500">Loading patent search...</div>}>
      <PatentSearchPage />
    </Suspense>
  )
}
