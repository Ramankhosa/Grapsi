import IdeaAnalysisWorkspace from '@/components/funding-intelligence/IdeaAnalysisWorkspace'

export default function IdeaIntelligenceRunPage({ params }: { params: { runId: string } }) {
  return <IdeaAnalysisWorkspace runId={params.runId} />
}
