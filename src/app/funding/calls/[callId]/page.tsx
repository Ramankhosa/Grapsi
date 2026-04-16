import FundingCallDetailPage from '@/components/funding/FundingCallDetailPage'

export default function FundingCallPage({ params }: { params: { callId: string } }) {
  return <FundingCallDetailPage callId={params.callId} />
}
