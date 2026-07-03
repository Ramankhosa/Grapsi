import ProjectDetailPage from '@/components/funding-intelligence/ProjectDetailPage'

export default function FundedProjectPage({ params }: { params: { projectId: string } }) {
  return <ProjectDetailPage projectId={params.projectId} />
}
