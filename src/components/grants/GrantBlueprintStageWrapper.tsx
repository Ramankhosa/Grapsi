'use client'

import BlueprintStage from '@/components/stages/BlueprintStage'

interface GrantBlueprintStageWrapperProps {
  sessionId: string
  authToken: string | null
  projectId: string
  grantSessionId: string
  onSessionUpdated?: (session: any) => void | Promise<void>
  onNavigateToStage?: (stage: string) => void
}

export default function GrantBlueprintStageWrapper({
  sessionId,
  authToken,
  projectId,
  grantSessionId,
  onSessionUpdated,
  onNavigateToStage,
}: GrantBlueprintStageWrapperProps) {
  return (
    <BlueprintStage
      sessionId={sessionId}
      authToken={authToken}
      onSessionUpdated={onSessionUpdated}
      onNavigateToStage={onNavigateToStage}
      grantContext={{
        grantSessionId,
        projectId,
        isGrantWorkspace: true,
      }}
    />
  )
}
