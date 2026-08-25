import { Suspense } from 'react'

import PatentDetailPage from '@/components/funding-intelligence/patents/PatentDetailPage'

function decodeParam(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function generateMetadata({ params }: { params: { publicationNumber: string } }) {
  const number = decodeParam(params.publicationNumber).slice(0, 60)
  return {
    title: `${number} | Patent Search | Paper Nest`,
    description: 'Patent record from PatentNest with citation and shortlist actions for your proposal.',
  }
}

export default function FundingIntelligencePatentDetail({ params }: { params: { publicationNumber: string } }) {
  return (
    <Suspense fallback={<div className="min-h-[70vh] bg-[#f6f8f7] p-8 text-sm text-slate-500">Loading patent...</div>}>
      <PatentDetailPage publicationNumber={decodeParam(params.publicationNumber)} />
    </Suspense>
  )
}
