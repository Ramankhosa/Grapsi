'use strict';
// Reuse immutable raw pilot responses only with their original supplied inputs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const P=require('./policy.cjs'),old=require('./policy-1.1.0.cjs');
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const totals=rows=>({pages:rows.length,titles:rows.reduce((n,r)=>n+r.details.candidates.length,0),openingDates:rows.reduce((n,r)=>n+r.details.candidates.filter(c=>c.opensOn).length,0),closingDates:rows.reduce((n,r)=>n+r.details.candidates.filter(c=>c.closesOn).length,0),warnings:rows.reduce((n,r)=>n+r.details.warnings.length,0)});
function main(){
 const corpusFile=arg('corpus'),resultFile=arg('results'),auditFile=arg('audit'),out=arg('out');
 if(!corpusFile||!resultFile||!auditFile||!out||!path.isAbsolute(out))throw Error('Provide absolute --out and --corpus, --results, --audit paths');
 const corpus=JSON.parse(fs.readFileSync(corpusFile)),baseline=fs.readFileSync(resultFile,'utf8').trim().split(/\r?\n/).map(s=>JSON.parse(s)),audit=JSON.parse(fs.readFileSync(auditFile));
 const beforeHash=P.sha256(fs.readFileSync(resultFile)),byId=new Map(corpus.map(r=>[r.id,r])),revalidated=[];
 for(const row of baseline){
  const source=byId.get(row.id);assert(source);assert(row.raw,'The original raw response is required');
  const page=old.packPage({title:source.page.title,url:source.url,text:source.page.text,truncated:source.page.truncated});
  assert.equal(row.policyHash,old.POLICY_HASH);assert.equal(row.inputHash,old.sha256(old.stable({page,date:source.asOfDate??old.dateInIndia()})));
  assert.deepEqual(old.validateDetails(row.raw,page),row.details,'Frozen baseline validation differs');
  revalidated.push({...row,originalPolicyHash:row.policyHash,validationPolicyHash:P.POLICY_HASH,details:P.validateDetails(row.raw,page)});
 }
 const selected=new Set(audit.rows.map(r=>r.id)),focused=corpus.filter(r=>selected.has(r.id));assert.equal(focused.length,19);assert.equal(new Set(baseline.map(r=>r.id)).size,300);
 const profiles=corpus.filter(r=>/people-profile/.test(r.url)).map(r=>{const name=r.page.text.match(/\nPeople\n([^\n]+)/)?.[1],input={...r.page,url:r.url};return {id:r.id,name,oldPresent:!!name&&old.packPage(input).text.includes(name),newPresent:!!name&&P.packPage(input).text.includes(name)}});
 for(const r of corpus){const input={...r.page,url:r.url},packed=P.packPage(input);assert(packed.text.length<=3400);for(const span of packed.text.split('[omitted content]').map(s=>s.trim()).filter(Boolean))assert(r.page.text.includes(span),'Packed content must remain literal');}
 const summary={at:new Date().toISOString(),baselineHash:beforeHash,baselinePolicy:old.POLICY_HASH,newPolicy:P.POLICY_HASH,promptUnchanged:P.TEMPLATE===old.TEMPLATE,baseline:totals(baseline),revalidated:totals(revalidated),profileIdentity:{total:profiles.length,previouslyPresent:profiles.filter(p=>p.oldPresent).length,nowPresent:profiles.filter(p=>p.newPresent).length},inferenceCalls:0,paidCostUSD:0,limitations:['Revalidation uses original packed inputs; it measures validator changes only.','The 19-page rerun separately measures packing changes and is not full accuracy acceptance.']};
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'revalidated-original-inputs.jsonl'),revalidated.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(path.join(out,'revalidation-summary.json'),JSON.stringify(summary,null,2));fs.writeFileSync(path.join(out,'focused-corpus.json'),JSON.stringify(focused));fs.writeFileSync(path.join(out,'profile-coverage.json'),JSON.stringify(profiles,null,2));
 assert.equal(P.sha256(fs.readFileSync(resultFile)),beforeHash);console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)try{main()}catch(e){console.error(e.message);process.exitCode=1}module.exports={totals};
