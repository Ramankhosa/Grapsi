import { SUMMARY_LENGTH, MAX_CITATIONS, type CatalogueMode } from './policy'

const common = new Set(`id callId fundingCallId title schemeTitle scheme_title shortDescription agencyName agency_name funderName sourceUrl source_url officialUrls closeDate close_date deadlineAt openDate open_date isRolling is_rolling opportunityStatus lifecycleStatus fundingKinds funding_kinds readiness readinessLabel templateStatus templateId guidelineStatus disciplines researchAreas importedAreas taxonomyAreaIds amountMin amountMax currency amountText amount_text country geography geographyScope funderCountry eligibleCountries eligibleRegions hostCountries institutionTypes careerStages citizenshipRequirements residencyRequirements applicationLanguages sponsorType sponsorTypeLabel score matchReasons profileMatch eligibilitySummary eligibilityVerdict isCatalog authoringReady limitedSubmissions matchedAreas matchScore semanticSimilarity textRank summary description`.split(' '))
const detail = new Set(`fullDescription eligibilityText eligibility_text expectedDeliverablesText contactInfo catalogImport templateStatus guidelineStatus catalogStatus visibility template guideline templateWorkspace guidelineWorkspace createdAt updatedAt publishedAt status amount_min amount_max applicant_scope applicant_country_codes applicant_excluded_codes residence_scope residence_country_codes residence_excluded_codes citizenship_scope citizenship_country_codes citizenship_excluded_codes host_scope host_country_codes host_excluded_codes`.split(' '))
// Curated business fields used by the intake editor and imported-call detail.
// Storage/provenance, vectors and operator notes are deliberately absent.
for(const name of `template_status guideline_status eligible_countries eligible_regions host_countries institution_types career_stages citizenship_requirements residency_requirements application_languages official_urls geography_scope funder_country project_duration_min_months project_duration_max_months project_duration_text expected_deliverables_text contact_info sponsor_type catalog_status is_active programIdentifier next_deadline_at final_deadline_at entry_closes_at deadline_timezone source_closed_at opportunity_status currency_code amount_time_basis amount_recipient_basis indirect_cost_policy indirect_cost_note amount_min_usd_est amount_max_usd_est fx_as_of requires_nomination nomination_note required_qualifications applicant_region_codes residence_region_codes citizenship_region_codes host_region_codes review_status import_run_id enrichment_level description_source source_disciplines source_subjects active_template_id active_guideline_id`.split(' ')) detail.add(name)
for(const name of `official_urls eligible_countries eligible_regions host_countries institution_types career_stages opportunity_status next_deadline_at final_deadline_at entry_closes_at template_status guideline_status`.split(' ')) common.add(name)
// Conflict-review DTOs have their own explicit, metered call projection.
for(const name of `agency eligibility eligibilityTruncated descriptionTruncated deadline amount source countryRequirements imported contentHash`.split(' ')) detail.add(name)
for(const name of `status is_active created_at updated_at published_at published_by publishedAt intake_job_id embedding_status`.split(' ')) common.add(name)
for(const name of `closesAt daysToClose isExpired tier basis source matchedOn alerted`.split(' ')) common.add(name)
for(const name of `promotedAt promotedBy activeMappings work enrichmentLevel ineligibleFor sourceAvailability funding projectDuration eligibility deliverables focusAreas warning`.split(' ')) detail.add(name)
detail.add('projectDurationText');detail.add('assets')
const forbidden = /^(raw_?payload|raw_?text|normalized_?text|embedding(?!_status$|Health$).*|imported_?values|internal.*|admin.*notes|operator_notes|sourceRecords|source_records|recentJobs|metadata|normalizedMetadata|extractedFacts|extracted_json|extraction_confidence_json|field_provenance|ts_document|result_snapshot_json_raw|searchDiagnostics|fullDescription)$/i
const callContainers = new Set(['call','calls','results','rawResults','recommendations','citations','opportunities','fundingCall','fundingCalls','matches','subject','candidate','subject_call','candidate_call','result_snapshot_json','resultSnapshot','snapshot'])
const chunkFields=new Set('chunkId documentId fundingCallId sectionId sectionTitle sectionType chunkText pageStart pageEnd similarity documentVersion'.split(' '))
export interface SanitizedCatalogueResponse { value: any; callIds: string[] }

export function sanitizeCatalogueResponse(input:any, mode:CatalogueMode,preserveWorkspace=false):SanitizedCatalogueResponse {
  const ids=new Set<string>()
  const walk=(value:any,key='',inCall=false):any=>{
    if(Array.isArray(value)){
      if(['resultIds','callIds','result_ids_json'].includes(key)){const bounded=value.slice(0,MAX_CITATIONS);bounded.forEach(id=>{if(typeof id==='string')ids.add(id)});return bounded}
      const bounded=(['citations','opportunities'].includes(key)||(mode==='ai'&&['results','rawResults'].includes(key)))?value.slice(0,MAX_CITATIONS):value
      if(callContainers.has(key)&&bounded.length>50)throw new Error('Unbounded catalogue response')
      return bounded.map(v=>walk(v,key,inCall))
    }
    if(!value||typeof value!=='object')return value
    const callId=value.fundingCallId||value.callId||value.id
    const referenceId=value.fundingCallId||value.funding_call_id
    if(typeof referenceId==='string'&&referenceId)ids.add(referenceId)
    const hasTitle=typeof value.title==='string'||typeof value.scheme_title==='string'||typeof value.schemeTitle==='string'
    const isChunk=typeof value.fundingCallId==='string'&&typeof value.chunkText==='string'
    const isCall=typeof callId==='string'&&hasTitle&&(callContainers.has(key)||'scheme_title'in value||'schemeTitle'in value||'agencyName'in value||'agency_name'in value)
    if(isCall||isChunk)ids.add(callId)
    const out:Record<string,any>={}
    for(const [k,v]of Object.entries(value)){
      // Proposal/reviewer metadata belongs to the user's work. Its contents
      // still pass through this walker; catalogue metadata is always removed.
      if(k==='metadata'&&preserveWorkspace&&!isCall&&!inCall){out[k]=walk(v,k);continue}
      if(k==='searchDiagnostics'){
        const diagnostics=v as {strictFilterRecovery?:unknown}|null
        if(diagnostics?.strictFilterRecovery)out[k]={strictFilterRecovery:walk(diagnostics.strictFilterRecovery,'strictFilterRecovery')}
        continue
      }
      if(/^(?:storage_?path|source_file_path)$/i.test(k))continue
      if(forbidden.test(k)&&!(mode==='detail'&&k==='fullDescription'))continue
      if(isChunk&&(!chunkFields.has(k)||(mode!=='detail'&&k==='chunkText')))continue
      if(isCall&&!common.has(k)&&!(mode==='detail'&&detail.has(k)))continue
      if(isCall&&mode!=='detail'&&['description','shortDescription','summary','eligibilitySummary'].includes(k)&&typeof v==='string')out[k]=v.slice(0,SUMMARY_LENGTH)
      else out[k]=walk(v,k,inCall||isCall)
    }
    return out
  }
  return {value:walk(input),callIds:[...ids]}
}
