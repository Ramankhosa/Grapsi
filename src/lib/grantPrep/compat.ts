export function serializeGrantPrepSession<T extends {
  project?: { id: string; name?: string | null; tenantId?: string | null } | null
  funding_call_id?: string | null
}>(session: T) {
  // The Draft Zero ledger (raw seed text + claims) is large and only consumed
  // by the dedicated /draft-zero endpoint — never ship it on general session
  // responses.
  const { draft_zero_state_json: _draftZeroState, ...rest } =
    session as T & { draft_zero_state_json?: unknown }

  if (!session?.project) {
    return rest
  }

  return {
    ...rest,
    project: {
      ...session.project,
      project_title: session.project.name || '',
      project_description: null,
      funding_call_id: session.funding_call_id || null,
    },
  }
}
