import FundingCallDetailPage from '@/components/funding/FundingCallDetailPage'

export default function SuperAdminFundingCallPage({ params }: { params: { callId: string } }) {
  return (
    <FundingCallDetailPage
      callId={params.callId}
      requireSuperAdmin
      backHref="/super-admin/funding/imports"
      backLabel="Back to platform funding review"
    />
  )
}
