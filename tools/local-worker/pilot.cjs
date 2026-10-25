'use strict';
// Offline, resumable validation. Never writes catalogue rows or sends paid requests.
const fs=require('node:fs'),P=require('./policy.cjs');
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const normal=s=>String(s??'').normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
function report(rows,results){
 const labelled=results.filter(r=>rows.find(p=>p.id===r.id)?.reviewed===true);
 const refs=new Map(rows.map(r=>[r.id,r]));const scored=labelled.filter(r=>refs.get(r.id).expected?.type);
 const titleRows=labelled.filter(r=>refs.get(r.id).expected?.title);
 const genuine=rows.filter(r=>r.reviewed===true&&r.expected?.genuineCall===true);
 const elapsed=results.map(r=>r.elapsedMs).sort((a,b)=>a-b);const counts=Object.fromEntries(P.TYPES.map(type=>[type,results.filter(r=>r.decision===type).length]));
 return {at:new Date().toISOString(),model:P.MODEL.id,policyHash:P.POLICY_HASH,total:rows.length,processed:results.length,reviewed:labelled.length,genuineReferenceCalls:genuine.length,
  acceptanceReady:rows.length>=300&&genuine.length>=100&&labelled.length===rows.length&&results.length===rows.length,
  classification:{counts,correct:scored.filter(r=>r.decision===refs.get(r.id).expected.type).length,total:scored.length},
  titles:{correct:titleRows.filter(r=>r.details.candidates.some(c=>normal(c.title)===normal(refs.get(r.id).expected.title))).length,total:titleRows.length},
  retainedGenuineCalls:labelled.filter(r=>refs.get(r.id).expected?.genuineCall===true).length,
  groundedTitles:results.reduce((n,r)=>n+r.details.candidates.length,0),groundedOpeningDates:results.reduce((n,r)=>n+r.details.candidates.filter(c=>c.opensOn).length,0),groundedClosingDates:results.reduce((n,r)=>n+r.details.candidates.filter(c=>c.closesOn).length,0),
  warnings:results.reduce((n,r)=>n+r.details.warnings.length,0),inferenceErrors:results.filter(r=>r.error).length,incompleteEvidence:results.filter(r=>r.details.needsMoreEvidence).length,
  totalInferenceMs:elapsed.reduce((n,t)=>n+t,0),meanMs:elapsed.length?Math.round(elapsed.reduce((n,t)=>n+t,0)/elapsed.length):null,medianMs:elapsed.length?elapsed[Math.floor(elapsed.length/2)]:null,p95Ms:elapsed.length?elapsed[Math.min(elapsed.length-1,Math.floor(elapsed.length*.95))]:null,
  paidCostUSD:0,deadlineAccuracy:null,limitations:['Retention does not establish discovery recall or an open application window.','Unreviewed/catalogue-derived references do not count as independently adjudicated labels.','Deadline accuracy and final opportunity precision require reviewed cloud extraction outcomes.']};
}
async function main(){
 const dataset=arg('dataset');if(!dataset)throw Error('Provide --dataset=path');const rows=JSON.parse(fs.readFileSync(dataset,'utf8'));
 const out=arg('out',dataset+'.results.jsonl'),summary=out+'.summary.json';const prior=fs.existsSync(out)?fs.readFileSync(out,'utf8').split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)):[];
 const latest=new Map(prior.filter(r=>r.policyHash===P.POLICY_HASH).map(r=>[r.id,r]));const results=[...latest.values()].filter(r=>rows.some(row=>row.id===r.id));const seen=new Map(results.map(r=>[r.id,r.inputHash]));
 const endpoint=arg('endpoint','http://127.0.0.1:11535');if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))throw Error('Pilot endpoint must be local loopback');
 const key=fs.readFileSync(arg('key-file'), 'utf8').trim();const limit=Number(arg('limit',String(rows.length)));
 for(const row of rows){
  const page=P.packPage({title:row.page.title,url:row.url,text:row.page.text,truncated:row.page.truncated});const inputHash=P.sha256(P.stable({page,date:row.asOfDate??P.dateInIndia()}));if(seen.get(row.id)===inputHash)continue;if(results.length>=limit)break;
  const started=Date.now();let raw={type:'UNSURE',candidates:[],needsMoreEvidence:true};let error=null;let usage=null;let finishReason=null;
  try{
   const response=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({messages:[{role:'system',content:P.TEMPLATE.replace('{DATE}',row.asOfDate??P.dateInIndia())},{role:'user',content:JSON.stringify(page)}],temperature:0,seed:42,max_tokens:1024,stream:false,reasoning_effort:'none',response_format:{type:'json_schema',json_schema:{name:'funding_titles',strict:true,schema:P.RESULT_SCHEMA}}}),signal:AbortSignal.timeout(180000)});
   if(response.status>=500)throw Error('Local server unavailable: '+response.status);
   if(response.ok){const data=await response.json();usage=data.usage??null;finishReason=data.choices?.[0]?.finish_reason??null;try{raw=JSON.parse(data.choices?.[0]?.message?.content??'{}')}catch{error='Invalid model JSON; retained as UNSURE'}}else error='Input could not be processed; retained as UNSURE';
  }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError'){error='Local inference timed out; retained as UNSURE'}else if(/unavailable|fetch failed/i.test(e.message)){fs.writeFileSync(summary,JSON.stringify(report(rows,results),null,2));throw e;}else error=e.message;}
  if(!raw||typeof raw!=='object'||!P.TYPES.includes(raw.type)){raw={type:'UNSURE',candidates:[],needsMoreEvidence:true};error=error??'Invalid model classification; retained as UNSURE'}
  const result={id:row.id,url:row.url,inputHash,policyHash:P.POLICY_HASH,decision:raw.type,details:P.validateDetails(raw,page),elapsedMs:Date.now()-started,error,usage,finishReason,raw};
  const fd=fs.openSync(out,'a');try{fs.writeSync(fd,JSON.stringify(result)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const old=results.findIndex(r=>r.id===row.id);if(old>=0)results[old]=result;else results.push(result);seen.set(row.id,inputHash);
  fs.writeFileSync(summary,JSON.stringify(report(rows,results),null,2));console.log(JSON.stringify({processed:results.length,total:rows.length,decision:result.decision,milliseconds:result.elapsedMs}));
 }
 fs.writeFileSync(summary,JSON.stringify(report(rows,results),null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});module.exports={report};
