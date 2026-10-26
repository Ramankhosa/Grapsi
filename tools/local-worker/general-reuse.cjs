'use strict';
// This reuses an identical local hypothesis only. Cloud triage still decides
// relevance; a local GENERAL result never suppresses paid investigation alone.
function sameGeneralEvidence(r,v,a,j,old,policy,model){return `(
 ${a}.resource_id=${r}.id AND ${a}.decision='GENERAL' AND ${a}.details->>'schemaVersion'='2'
 AND ${a}.policy_hash=${policy} AND ${j}.policy_hash=${policy} AND ${a}.model_sha256=${model}
 AND ${a}.input_hash=${j}.input_hash AND ${j}.payload->>'sourceHash'=${old}.raw_hash
 AND ${j}.payload->>'fullTextHash'=encode(sha256(convert_to(${old}.text,'UTF8')),'hex')
 AND NOT ${old}.truncated AND NOT ${v}.truncated AND ${old}.text=${v}.text
 AND ${j}.payload->'page'->>'title'=left(coalesce(${r}.title,''),500)
 AND ${j}.payload->'page'->>'url'=${r}.canonical_url
)`;}
function hasReusableGeneral(r,v,policy,model){return `EXISTS(
 SELECT 1 FROM monitor_local_analysis_results reuse_a
 JOIN monitor_local_analysis_jobs reuse_j ON reuse_j.id=reuse_a.job_id
 JOIN monitor_resource_versions reuse_v ON reuse_v.id=reuse_a.version_id
 WHERE ${sameGeneralEvidence(r,v,'reuse_a','reuse_j','reuse_v',policy,model)}
)`;}
module.exports={sameGeneralEvidence,hasReusableGeneral};
