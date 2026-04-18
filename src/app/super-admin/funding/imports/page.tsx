import FundingImportsPage from '@/components/funding/FundingImportsPage'

export default function SuperAdminFundingImportsPage() {
  return (
    <FundingImportsPage
      requireSuperAdmin
      basePath="/super-admin/funding"
      title="Platform Funding Review"
      description="Review funding imports across tenants. Tenant-private submissions stay scoped until you approve and publish them through the intake and catalog workspaces."
    />
  )
}
