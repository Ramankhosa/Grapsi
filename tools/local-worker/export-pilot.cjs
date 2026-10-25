'use strict';
// Read-only corpus export. Catalogue membership supplies a provisional reference,
// never an independently adjudicated gold label or proof of a current window.
const fs=require('node:fs'),path=require('node:path');
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
async function main(){
 const root=arg('app-root',process.cwd()),out=arg('out');if(!out||!path.isAbsolute(out))throw Error('An absolute --out path is required');
 const {loadDb}=require(arg('broker',path.join(__dirname,'broker.cjs')));const db=loadDb(root);
 try{
  const calls=await db.fundingCall.findMany({where:{catalog_status:'PUBLISHED',OR:[{normalized_text:{not:''}},{raw_text:{not:''}}]},select:{id:true,title:true,source_url:true,sourceUrl:true,normalized_text:true,raw_text:true,open_date:true,close_date:true},orderBy:{updatedAt:'desc'},take:2000});
  const resources=await db.monitorResource.findMany({where:{site:{status:'ACTIVE'},canonical_url:{not:null},current_version_id:{not:null}},select:{id:true,title:true,canonical_url:true,current_version_id:true},orderBy:{last_observed_at:'desc'},take:1000});
  const versions=await db.monitorResourceVersion.findMany({where:{id:{in:resources.map(r=>r.current_version_id).filter(Boolean)}},select:{id:true,text:true,truncated:true}});const byVersion=new Map(versions.map(v=>[v.id,v]));
  const asOfDate=new Date().toISOString().slice(0,10),seen=new Set(),rows=[];
  for(const call of calls){const text=call.normalized_text||call.raw_text||'',url=call.source_url||call.sourceUrl;if(text.length<100||!/^https?:\/\//.test(url??''))continue;if(seen.has(url))continue;seen.add(url);rows.push({id:'catalogue:'+call.id,url,asOfDate,page:{title:call.title,text},reviewed:false,labelProvenance:'Published catalogue; source and window need independent adjudication',expected:{title:call.title,genuineCall:true,openDate:call.open_date?.toISOString().slice(0,10)??null,closeDate:call.close_date?.toISOString().slice(0,10)??null}})}
  const catalogueReferences=rows.length;
  for(const resource of resources){if(rows.length>=300)break;const version=byVersion.get(resource.current_version_id);if(!version?.text||version.text.length<80||seen.has(resource.canonical_url))continue;seen.add(resource.canonical_url);rows.push({id:'crawler:'+resource.id,url:resource.canonical_url,asOfDate,page:{title:resource.title,text:version.text,truncated:version.truncated},reviewed:false,labelProvenance:'Unlabelled captured production evidence',expected:{}})}
  fs.writeFileSync(out,JSON.stringify(rows.slice(0,300)),{mode:0o600});console.log(JSON.stringify({total:Math.min(rows.length,300),catalogueReferences,independentlyReviewed:0,out}));
 }finally{await db.$disconnect()}
}
main().catch(e=>{console.error(e.code||e.name);process.exitCode=1});
