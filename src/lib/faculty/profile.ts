import prisma from '@/lib/prisma'

export interface FacultyProfilePayload {
  userId: string
  name: string
  email: string
  /** Only for callers allowed to see staff identifiers; null otherwise. */
  employeeId: string | null
  designation: string | null
  school: string | null
  department: string | null
  institution: string | null
  careerStage: string | null
  yearsOfExperience: number | null
  country: string | null
  languages: string[]
  summary: string | null
  researchAreas: string[]
  keywords: string[]
  links: { googleScholar: string | null; scopus: string | null; orcid: string | null; linkedin: string | null }
  publications: Array<{ id: string; title: string | null; authors: string[]; year: number | null; venue: string | null; doi: string | null; url: string | null }>
}

/**
 * One researcher's stored profile and tagged publications: what "View profile"
 * shows. Always tenant-fenced; `unitIds` narrows it further to a caller's
 * managed schools, and `includeEmployeeId` decides whether the staff number is
 * part of it. Returns null when the person is outside that fence.
 */
export async function loadFacultyProfile(options: {
  tenantId: string
  userId: string
  unitIds?: string[] | null
  activeOnly?: boolean
  includeEmployeeId: boolean
}): Promise<FacultyProfilePayload | null> {
  const { tenantId, userId, unitIds, activeOnly, includeEmployeeId } = options
  const profile = await prisma.researcherProfile.findFirst({
    where: {
      user_id: userId,
      user: { tenantId, ...(activeOnly ? { status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } } : {}) },
      ...(unitIds ? { org_unit_id: { in: unitIds.length > 0 ? unitIds : ['__none__'] } } : {}),
    },
    select: {
      user: { select: { id: true, name: true, email: true } },
      display_name: true,
      employee_id: includeEmployeeId,
      designation: true,
      school: true,
      department: true,
      institution_name: true,
      career_stage: true,
      years_of_experience: true,
      country_of_residence: true,
      application_languages: true,
      research_summary: true,
      research_areas: true,
      keywords: true,
      linkedin_url: true,
      google_scholar_url: true,
      scopus_url: true,
      orcid_url: true,
    },
  })
  // Discovery also lists active colleagues who have not yet created a profile.
  const identity = profile?.user || (activeOnly && !unitIds ? await prisma.user.findFirst({
    where: { id: userId, tenantId, status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } },
    select: { id: true, name: true, email: true },
  }) : null)
  if (!identity) return null

  const publications = await prisma.referenceLibrary.findMany({
    where: { userId, isActive: true, tags: { has: 'my-publication' } },
    select: { id: true, title: true, authors: true, year: true, venue: true, doi: true, url: true },
    orderBy: [{ year: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 25,
  })

  return {
    userId: identity.id,
    name: profile?.display_name || identity.name || identity.email,
    email: identity.email,
    employeeId: includeEmployeeId ? profile?.employee_id ?? null : null,
    designation: profile?.designation ?? null,
    school: profile?.school ?? null,
    department: profile?.department ?? null,
    institution: profile?.institution_name ?? null,
    careerStage: profile?.career_stage ?? null,
    yearsOfExperience: profile?.years_of_experience ?? null,
    country: profile?.country_of_residence ?? null,
    languages: profile?.application_languages ?? [],
    summary: profile?.research_summary ?? null,
    researchAreas: profile?.research_areas ?? [],
    keywords: profile?.keywords ?? [],
    links: {
      googleScholar: profile?.google_scholar_url ?? null,
      scopus: profile?.scopus_url ?? null,
      orcid: profile?.orcid_url ?? null,
      linkedin: profile?.linkedin_url ?? null,
    },
    publications: publications.map((p) => ({
      id: p.id, title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi, url: p.url,
    })),
  }
}
