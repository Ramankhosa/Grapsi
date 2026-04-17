export function serializeGrantPrepSession<T extends {
  project?: { id: string; name?: string | null; tenantId?: string | null } | null
  funding_call_id?: string | null
}>(session: T) {
  if (!session?.project) {
    return session
  }

  return {
    ...session,
    project: {
      ...session.project,
      project_title: session.project.name || '',
      project_description: null,
      funding_call_id: session.funding_call_id || null,
    },
  }
}
