export const EXPOSURE_LIMITS = {
  summary: [[1, 1000], [7, 2500], [30, 5000]],
  detail: [[1, 200], [7, 600], [30, 1200]],
} as const
export type ExposureKind = keyof typeof EXPOSURE_LIMITS
export type CatalogueMode = 'summary' | 'detail' | 'ai' | 'metadata'
export const SESSION_LIMIT = 2
export const MAX_CITATIONS = 10
export const SUMMARY_LENGTH = 320
function configured(name:string,fallback:number,max:number){
  const value=Number(process.env[name]);return Number.isInteger(value)&&value>0&&value<=max?value:fallback
}
export function catalogueLimits(){
  return {requests:configured('CATALOGUE_REQUESTS_PER_MINUTE',60,600),searches:configured('CATALOGUE_CONCURRENT_SEARCHES',3,10),ai:configured('CATALOGUE_CONCURRENT_AI',1,3),bytes:configured('CATALOGUE_BYTES_PER_MINUTE',8_000_000,50_000_000),
    exposure:{summary:EXPOSURE_LIMITS.summary.map(([days,limit])=>[days,configured(`CATALOGUE_SUMMARY_${days}_DAY`,limit,50000)]),detail:EXPOSURE_LIMITS.detail.map(([days,limit])=>[days,configured(`CATALOGUE_DETAIL_${days}_DAY`,limit,10000)])}}
}
export class CatalogueAccessError extends Error {
  constructor(public code: string, message: string, public status = 429, public retryAfter = 60) { super(message) }
}
export function assertBoundedIds(ids: string[]) {
  if (ids.length > 50 || ids.some(id => typeof id !== 'string' || id.length > 100)) {
    throw new CatalogueAccessError('RESPONSE_TOO_LARGE', 'Please narrow your funding search.', 400)
  }
  return [...new Set(ids)]
}
