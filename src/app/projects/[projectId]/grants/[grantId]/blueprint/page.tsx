import { redirect } from 'next/navigation'

export default async function GrantBlueprintRedirectPage({
  params,
}: {
  params: Promise<{ projectId: string; grantId: string }>
}) {
  const { projectId, grantId } = await params
  redirect(`/projects/${projectId}/grants/${grantId}/workspace?stage=BLUEPRINT`)
}
