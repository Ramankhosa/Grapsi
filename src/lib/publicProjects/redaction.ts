/**
 * Funded-project records are third-party data about named individuals. The
 * researcher-facing surfaces present the award as institutional evidence, so
 * personal identifiers are stripped before a payload leaves the API. Internal
 * super-admin views keep working against the service directly.
 */
export function redactProjectPeople<T extends Record<string, any>>(project: T) {
  const { primaryInvestigatorName, participants, ...rest } = project as Record<string, any>
  return rest as Omit<T, 'primaryInvestigatorName' | 'participants'>
}

export function redactProjectListPeople<T extends Record<string, any>>(projects: T[]) {
  return projects.map(redactProjectPeople)
}
