const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PassThrough}=require('node:stream');
const {Broker,initialize,stdio}=require('./broker.cjs');const P=require('./policy.cjs');
let db;
const moduleRoot=process.env.GRAPSI_TEST_MODULE_ROOT||'C:/Users/raman/Documents/Grapsi';
const load=name=>require(require.resolve(name,{paths:[moduleRoot]}));
before(async()=>{
  const dotenv=load('dotenv');let env={};
  for(const file of ['.env','.env.local']){const name=path.join(moduleRoot,file);if(fs.existsSync(name))Object.assign(env,dotenv.parse(fs.readFileSync(name)));}
  const base=new URL(env.DATABASE_URL);
  assert(['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname),'Tests require a local PostgreSQL instance');
  const {PrismaClient}=load('@prisma/client');const admin=new PrismaClient({datasources:{db:{url:base.href}}});
  const name='grapsi_local_worker_test';assert(name.endsWith('_test'));assert.notEqual(base.pathname,'/'+name);
  if(!(await admin.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1',name)).length)await admin.$executeRawUnsafe('CREATE DATABASE "'+name+'"');
  await admin.$disconnect();base.pathname='/'+name;
  db=new PrismaClient({datasources:{db:{url:base.href}}});
  const foundation=[
    "CREATE TABLE IF NOT EXISTS monitor_sites(id text PRIMARY KEY,host text,status text)",
    "CREATE TABLE IF NOT EXISTS monitor_resources(id text PRIMARY KEY,site_id text REFERENCES monitor_sites(id),current_version_id text,title text,canonical_url text,dedup_key text,last_observed_at timestamp DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS monitor_resource_versions(id text PRIMARY KEY,resource_id text REFERENCES monitor_resources(id),text text,truncated boolean DEFAULT false,raw_hash text,meaningful_hash text)",
    "CREATE TABLE IF NOT EXISTS monitor_opportunities(id text PRIMARY KEY,primary_resource_id text,field_evidence jsonb)",
    "CREATE TABLE IF NOT EXISTS monitor_skip_rules(id text PRIMARY KEY,site_id text REFERENCES monitor_sites(id),dedup_key text,match text,expires_at timestamp)"
  ];
  for(const sql of foundation)await db.$executeRawUnsafe(sql);
  await initialize(db);
});
beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE monitor_local_analysis_results,monitor_local_analysis_jobs,monitor_local_workers,monitor_skip_rules,monitor_opportunities,monitor_resource_versions,monitor_resources,monitor_sites CASCADE');});
after(async()=>{if(db)await db.$disconnect();});
async function page(id='r1',text='Applications invited for research grant support until December 2026.'){
  await db.$executeRawUnsafe("INSERT INTO monitor_sites VALUES('site','unit-test.invalid','ACTIVE') ON CONFLICT DO NOTHING");
  await db.$executeRawUnsafe("INSERT INTO monitor_resources(id,site_id,current_version_id,title,canonical_url,dedup_key) VALUES($1,'site',$2,'Grant applications',$3,$3)",id,id+'-v1','https://unit-test.invalid/'+id);
  await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) VALUES($1,$2,$3,$4,$4)",id+'-v1',id,text,P.sha256(text));
}
async function connect(options={}){const broker=new Broker(db,{allowedHosts:['unit-test.invalid'],...options});await broker.hello({protocol:P.PROTOCOL,workerId:crypto.randomUUID(),displayName:'test laptop',appVersion:options.appVersion??P.APP_VERSION,modelSha256:P.MODEL.sha256});return broker;}
const completion=job=>({jobId:job.id,leaseToken:job.leaseToken,inputHash:job.inputHash,modelSha256:P.MODEL.sha256,policyHash:P.POLICY_HASH,decision:'CALL',elapsedMs:1500});
test('an approaching supported deadline takes priority over an old ordinary job',async()=>{
 await page('old');await page('urgent');const broker=await connect();await broker.scan();await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET created_at=now()-interval '8 hours' WHERE resource_id='old'");await db.$executeRawUnsafe("INSERT INTO monitor_opportunities VALUES('deadline','urgent',jsonb_build_object('payload',jsonb_build_object('fields',jsonb_build_object('close_date',jsonb_build_object('status','supported','value',to_char(current_date+2,'YYYY-MM-DD'))))))");assert.equal((await broker.claim()).job.payload.resourceId,'urgent');
});
test('proposed dates require literal unambiguous quotations and do not splice separate dates',()=>{
 assert(P.groundedDate('2026-11-30','Applications close on 30 November 2026.'));
 assert(!P.groundedDate('2026-11-10','Applications close 10/11/2026.'));
 assert(!P.groundedDate('2026-11-30','Applications open on 10 November 2026 and close 30 December 2026.'));
 assert(!P.groundedDate('2026-02-30','Applications close 2026-02-30.'));
 assert(!P.applicationDate('opensOn','2026-11-18','Proposals will be accepted until November 18th, 2026.'));
 assert(P.applicationDate('opensOn','2026-11-01','Applications open on 1 November 2026.'));
 assert(P.applicationDate('closesOn','2026-11-30','Applications close on 30 November 2026. Deadline: November 30, 2026.'));
 const page={title:'Alpha Research Grant',text:'Applications close 30 November 2026.'};const details=P.validateDetails({candidates:[{title:page.title,titleQuote:page.title,closesOn:'2026-11-30',closesQuote:page.text}]},page);
 assert.equal(details.candidates[0].closesOn,'2026-11-30');
 const bad=P.validateDetails({candidates:[{title:page.title,titleQuote:page.title,closesOn:'2026-12-31',closesQuote:page.text}]},page);assert.equal(bad.candidates[0].closesOn,null);assert(bad.warnings.length);
});
test('legacy workers may reconnect to upload but cannot claim new title analysis',async()=>{
 const broker=new Broker(db);const hello=await broker.hello({protocol:1,workerId:crypto.randomUUID(),appVersion:'1.0.0',modelSha256:P.MODEL.sha256});assert.equal(hello.policyHash,P.LEGACY_POLICY_HASH);await assert.rejects(broker.claim(),{code:'UPGRADE_REQUIRED'});
});
test('worker 1.1.0 receives its frozen policy and cannot claim upgraded jobs',async()=>{
 const previous=require('./policy-1.1.0.cjs');const broker=new Broker(db);
 const hello=await broker.hello({protocol:2,workerId:crypto.randomUUID(),appVersion:'1.1.0',modelSha256:P.MODEL.sha256});assert.equal(hello.policyHash,previous.POLICY_HASH);assert.equal(hello.promptTemplate,previous.TEMPLATE);
 await assert.rejects(broker.claim(),{code:'UPGRADE_REQUIRED'});
});
test('a saved 1.1.0 submission keeps frozen validation and the same acknowledgement hash',async()=>{
 await page('old','REGULAR GRANT PROGRAMME\nApplications close 30 November 2026.');const broker=await connect(),{job}=await broker.claim();const previous=require('./policy-1.1.0.cjs');
 await db.$executeRawUnsafe('UPDATE monitor_local_analysis_jobs SET policy_hash=$1 WHERE id=$2',previous.POLICY_HASH,job.id);
 const input={...completion(job),policyHash:previous.POLICY_HASH,details:{candidates:[{title:'Regular Grant Programme',titleQuote:'REGULAR GRANT PROGRAMME'}]}};
 const ack=await broker.complete(input);assert.equal(ack.details.candidates.length,0);assert.equal((await broker.complete(input)).duplicate,true);
 await assert.rejects(broker.complete({...input,details:{candidates:[{title:'REGULAR GRANT PROGRAMME',titleQuote:'REGULAR GRANT PROGRAMME'}]}}),{code:'RESULT_CONFLICT'});
});
test('flattened long paragraphs retain an application invitation in their middle',()=>{
 const page=P.packPage({title:'Research',text:'navigation '.repeat(600)+' Applications invited for the Alpha Research Grant. Deadline 30 November 2026. '+'navigation '.repeat(600)});assert(page.text.includes('Alpha Research Grant'));assert(page.truncated);assert(page.text.length<=3400);
});
test('idle device discovers stored pages and returns a versioned shadow result',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();assert(job);assert.equal(job.payload.versionId,'r1-v1');
  assert.equal((await broker.complete(completion(job))).accepted,true);
  const rows=await db.$queryRawUnsafe('SELECT * FROM monitor_local_analysis_results');assert.equal(rows.length,1);assert.equal(rows[0].mode,'SHADOW');
  assert.equal((await broker.claim()).job,null);
});

test('the independent scanner reuses identical GENERAL evidence after a new raw version',async()=>{
 await page();const broker=await connect(),{job}=await broker.claim();await broker.complete({...completion(job),decision:'GENERAL',details:{needsMoreEvidence:false}});
 await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) SELECT 'r1-v2',resource_id,text,'raw-churn',meaningful_hash FROM monitor_resource_versions WHERE id='r1-v1'");
 await db.$executeRawUnsafe("UPDATE monitor_resources SET current_version_id='r1-v2' WHERE id='r1'");broker.lastScan=0;
 assert.equal(await broker.scan(),0);assert.equal((await broker.claim()).job,null);
 assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM monitor_local_analysis_results'))[0].n,1);
});

test('a redundant queued job is retained as superseded while saved acknowledgements remain idempotent',async()=>{
 await page();const broker=await connect(),{job}=await broker.claim(),input={...completion(job),decision:'GENERAL',details:{needsMoreEvidence:false}};await broker.complete(input);
 await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) SELECT 'r1-v2',resource_id,text,'raw-churn',meaningful_hash FROM monitor_resource_versions WHERE id='r1-v1'");
 await db.$executeRawUnsafe("UPDATE monitor_resources SET current_version_id='r1-v2' WHERE id='r1'");
 const row=(await db.$queryRawUnsafe("SELECT r.id,r.current_version_id,r.title,r.canonical_url AS url,v.text,v.raw_hash,v.truncated FROM monitor_resources r JOIN monitor_resource_versions v ON v.id=r.current_version_id WHERE r.id='r1'"))[0],payload=P.makePayload(row),id=crypto.randomUUID();
 await db.$executeRawUnsafe("INSERT INTO monitor_local_analysis_jobs(id,resource_id,version_id,policy_hash,input_hash,payload) VALUES($1,'r1','r1-v2',$2,$3,$4::jsonb)",id,P.POLICY_HASH,P.sha256(JSON.stringify(payload)),JSON.stringify(payload));
 assert.equal((await broker.claim()).job,null);assert.equal((await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs WHERE id=$1',id))[0].state,'SUPERSEDED');assert.equal((await broker.complete(input)).duplicate,true);
});

test('an identical page with a changed heading still gets a new local job',async()=>{
 await page();const broker=await connect(),{job}=await broker.claim();await broker.complete({...completion(job),decision:'GENERAL'});
 await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) SELECT 'r1-v2',resource_id,text,'new-heading',meaningful_hash FROM monitor_resource_versions WHERE id='r1-v1'");
 await db.$executeRawUnsafe("UPDATE monitor_resources SET current_version_id='r1-v2',title='New research applications' WHERE id='r1'");broker.lastScan=0;
 assert.equal((await broker.claim()).job.payload.versionId,'r1-v2');
});
test('an offline host leaves work durable and another host reclaims an expired lease',async()=>{
  await page();const first=await connect(),second=await connect();const {job}=await first.claim();
  assert.equal((await second.claim()).job,null);
  await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET lease_until=now()-interval '1 second'");
  const reclaimed=(await second.claim()).job;assert.equal(reclaimed.id,job.id);assert.notEqual(reclaimed.leaseToken,job.leaseToken);
  await assert.rejects(first.complete(completion(job)),{code:'LEASE_LOST'});
  assert.equal((await second.complete(completion(reclaimed))).accepted,true);
});

test('offline backlog uses the current date when judging call deadlines',async()=>{
  await page();const broker=await connect();await broker.scan();
  await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET payload=jsonb_set(payload,'{asOfDate}','\"2020-01-01\"'::jsonb)");
  const {job}=await broker.claim();assert.equal(job.payload.asOfDate,P.dateInIndia());
  // PostgreSQL jsonb canonicalizes key order; the lease binds the returned representation.
  assert.equal(job.inputHash,P.sha256(JSON.stringify(job.payload)));
  assert.equal((await broker.complete(completion(job))).accepted,true);
});
test('lost upload acknowledgement can be retried without duplicate results',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  assert.equal((await broker.complete(completion(job))).duplicate,false);
  assert.equal((await broker.complete(completion(job))).duplicate,true);
  const count=await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM monitor_local_analysis_results');assert.equal(count[0].n,1);
  await assert.rejects(broker.complete({...completion(job),decision:'GENERAL'}),{code:'RESULT_CONFLICT'});
});
test('changed content rejects a late result and queues the new version',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) VALUES('r1-v2','r1','This grant call has closed; archived guidelines are available.','new','new')");
  await db.$executeRawUnsafe("UPDATE monitor_resources SET current_version_id='r1-v2' WHERE id='r1'");
  assert.equal((await broker.complete(completion(job))).stale,true);
  broker.lastScan=0;const newer=(await broker.claim()).job;assert.equal(newer.payload.versionId,'r1-v2');
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM monitor_local_analysis_results'))[0].n,0);
});
test('parallel claims are exclusive and one device cannot consume multiple jobs',async()=>{
  await page('r1');await page('r2');const first=await connect(),second=await connect();
  const responses=await Promise.all([first.claim(),first.claim(),second.claim()]);
  const jobs=responses.map(r=>r.job).filter(Boolean);assert.equal(jobs.length,2);assert.equal(new Set(jobs.map(j=>j.id)).size,2);
});
test('heartbeat extends a live lease and cannot revive an expired lease',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  assert.equal((await broker.heartbeat({jobId:job.id,leaseToken:job.leaseToken})).held,true);
  await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET lease_until=now()-interval '1 second'");
  assert.equal((await broker.heartbeat({jobId:job.id,leaseToken:job.leaseToken})).held,false);
});
test('paused sites and newly added skip rules reject results',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  await db.$executeRawUnsafe("UPDATE monitor_sites SET status='PAUSED'");
  assert.equal((await broker.complete(completion(job))).stale,true);
});
test('do-not-visit rules prevent discovery and folder underscores are literal',async()=>{
  await page('r_1');await page('rX1');
  await db.$executeRawUnsafe("INSERT INTO monitor_skip_rules VALUES('skip','site','https://unit-test.invalid/r_1','PAGE',NULL)");
  const broker=await connect();const {job}=await broker.claim();assert.equal(job.payload.resourceId,'rX1');
  assert.equal(P.skipped('https://www.example.com/a_b/c',[{dedup_key:'https://example.com/a_b',match:'FOLDER'}]),true);
  assert.equal(P.skipped('https://example.com/aXb/c',[{dedup_key:'https://example.com/a_b',match:'FOLDER'}]),false);
});
test('bad model, bad results, forged leases and unknown commands are rejected',async()=>{
  const broker=new Broker(db);await assert.rejects(broker.hello({protocol:P.PROTOCOL,workerId:crypto.randomUUID(),modelSha256:'bad'}),{code:'MODEL_MISMATCH'});
  await page();const valid=await connect();const {job}=await valid.claim();
  await assert.rejects(valid.complete({...completion(job),decision:'PUBLISH'}),{code:'INVALID_RESULT'});
  await assert.rejects(valid.complete({...completion(job),leaseToken:crypto.randomUUID()}),{code:'LEASE_LOST'});
  await assert.rejects(valid.dispatch({action:'constructor'}),{code:'INVALID_REQUEST'});
  await assert.rejects(valid.complete({...completion(job),elapsedMs:-1}),{code:'INVALID_RESULT'});
});
test('pause releases only the correct lease and does not lose work',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  assert.equal((await broker.release({jobId:job.id,leaseToken:crypto.randomUUID()})).released,false);
  assert.equal((await broker.release({jobId:job.id,leaseToken:job.leaseToken})).released,true);
  const rows=await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs');assert.equal(rows[0].state,'QUEUED');
});
test('production can pause new claims without losing queued jobs',async()=>{
  await page();let config={enabled:true,allowedHosts:['unit-test.invalid']};const broker=await connect({reload:()=>config});
  await broker.scan();config={...config,enabled:false};assert.equal((await broker.claim()).paused,true);
  assert.equal((await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs'))[0].state,'QUEUED');
});
test('queue scheduler enqueues offline work and returns abandoned jobs to the queue',async()=>{
  await page();const scheduler=new Broker(db,{allowedHosts:['unit-test.invalid']});
  assert.equal(await scheduler.scan(),1);
  const broker=await connect();const {job}=await broker.claim();
  await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET lease_until=now()-interval '1 second'");
  await scheduler.sweep();
  assert.equal((await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs'))[0].state,'QUEUED');
  await assert.rejects(broker.complete(completion(job)),{code:'LEASE_LOST'});
  assert((await (await connect()).claim()).job);
});
test('content changed in place is also rejected instead of overwriting evidence',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  await db.$executeRawUnsafe("UPDATE monitor_resource_versions SET text='New replacement evidence for this page' WHERE id='r1-v1'");
  assert.equal((await broker.complete(completion(job))).stale,true);
});
test('legacy production schemas without optional skip-rule tables remain supported',async()=>{
  await db.$executeRawUnsafe('DROP TABLE monitor_skip_rules');
  try{await page();const broker=await connect();const {job}=await broker.claim();assert.equal((await broker.complete(completion(job))).accepted,true);}
  finally{await db.$executeRawUnsafe("CREATE TABLE monitor_skip_rules(id text PRIMARY KEY,site_id text REFERENCES monitor_sites(id),dedup_key text,match text,expires_at timestamp)");}
});
test('a skip rule added after a claim prevents accepting the result',async()=>{
  await page();const broker=await connect();const {job}=await broker.claim();
  await db.$executeRawUnsafe("INSERT INTO monitor_skip_rules VALUES('late','site','https://unit-test.invalid/r1','PAGE',NULL)");
  assert.equal((await broker.complete(completion(job))).stale,true);
});
test('permanent failures are bounded and cannot consume the whole queue',async()=>{
  await page();const broker=await connect();await broker.claim();
  await db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET attempts=5,lease_until=now()-interval '1 second'");
  await broker.sweep();assert.equal((await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs'))[0].state,'FAILED');
  await page('r2');broker.lastScan=0;assert.equal((await broker.claim()).job.payload.resourceId,'r2');
});
test('request framing is bounded and does not execute oversized data',async()=>{
  const input=new PassThrough(),output=new PassThrough();let data='';output.on('data',chunk=>data+=chunk.toString());
  const running=stdio({dispatch:()=>{throw Error('must not run');}},input,output);
  input.end('x'.repeat(65537));await running;assert.match(data,/REQUEST_TOO_LARGE/);
});
test('date and packing preserve input provenance without following page instructions',()=>{
  assert.equal(P.dateInIndia(new Date('2026-10-24T21:00:00Z')),'25 October 2026');
  const packed=P.packPage({title:'x',url:'https://unit-test.invalid',text:'x'.repeat(5000)});assert.equal(packed.truncated,true);assert(packed.text.length<=3400);
  assert.equal(P.publicUrl('http://127.0.0.1/x','127.0.0.1'),false);
});
test('grounded title suggestions survive while invented titles are removed without another model call',async()=>{
  await page('title','Alpha Research Grant 2026 invites applications from researchers for funding until December 2026.')
  const broker=await connect();const {job}=await broker.claim();const input={...completion(job),details:{candidates:[{title:'Alpha Research Grant 2026',titleQuote:'Alpha Research Grant 2026 invites applications',invitationQuote:'invites applications'},{title:'Invented Grant',titleQuote:'Invented Grant is open',invitationQuote:null}],multipleCalls:false,needsMoreEvidence:false}}
  const ack=await broker.complete(input);assert.equal(ack.details.candidates.length,1);assert.equal(ack.details.needsMoreEvidence,true)
  assert.equal((await broker.complete(input)).duplicate,true)
  await assert.rejects(broker.complete({...input,details:{...input.details,candidates:[]}}),{code:'RESULT_CONFLICT'})
})
test('section selection retains application evidence from the middle of a long page',()=>{
 const text=Array.from({length:100},(_,i)=>i===55?'The Alpha Research Grant invites applications until 30 November 2026.':'Navigation text for informational sections '+i).join('\n')
 const page=P.packPage({title:'Scheme',url:'https://unit-test.invalid',text});assert(page.text.includes('30 November 2026'));assert(page.truncated)
})
test('legacy queued submissions can be acknowledged after the worker upgrade',async()=>{
 await page();const broker=await connect();const {job}=await broker.claim();await db.$executeRawUnsafe('UPDATE monitor_local_analysis_jobs SET policy_hash=$1 WHERE id=$2',P.LEGACY_POLICY_HASH,job.id)
 const ack=await broker.complete({...completion(job),policyHash:P.LEGACY_POLICY_HASH});assert(ack.accepted)
})

async function importedPage(host){
  const id='imp-'+host,text='Applications invited for the imported research fellowship until March 2027.';
  await db.$executeRawUnsafe("INSERT INTO monitor_sites VALUES($1,$2,'ACTIVE') ON CONFLICT DO NOTHING",'site-'+host,host);
  await db.$executeRawUnsafe("INSERT INTO monitor_resources(id,site_id,current_version_id,title,canonical_url,dedup_key) VALUES($1,$2,$3,'Imported call',$4,$4) ON CONFLICT DO NOTHING",id,'site-'+host,id+'-v1','https://'+host+'/call');
  await db.$executeRawUnsafe("INSERT INTO monitor_resource_versions(id,resource_id,text,raw_hash,meaningful_hash) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING",id+'-v1',id,text,P.sha256(text));
  // Source Watch queues the job (laptop-first screening); the host is not on the configured list.
  assert.equal(await new Broker(db,{allowedHosts:[host]}).scan(),1);
}
test('jobs Source Watch queued for any approved site reach the laptop without a host-list edit',async()=>{
  await importedPage('imported.invalid');
  const strict=await connect();
  assert.equal((await strict.claim()).job,null,'the configured list alone does not include the imported site');
  const broker=await connect({allowApprovedSites:true});
  const hello=await broker.hello({protocol:P.PROTOCOL,workerId:broker.worker,displayName:'test laptop',appVersion:P.APP_VERSION,modelSha256:P.MODEL.sha256});
  assert(hello.approvedHosts.includes('imported.invalid')&&hello.approvedHosts.includes('unit-test.invalid'));
  const {job}=await broker.claim();
  assert.equal(job.payload.page.url,'https://imported.invalid/call');
  assert.equal((await broker.complete(completion(job))).accepted,true);
  assert.equal((await db.$queryRawUnsafe('SELECT state FROM monitor_local_analysis_jobs'))[0].state,'DONE');
});
test('approved-site access never covers paused sites and never widens the background sweep',async()=>{
  await importedPage('paused.invalid');
  await db.$executeRawUnsafe("UPDATE monitor_sites SET status='PAUSED' WHERE host='paused.invalid'");
  const broker=await connect({allowApprovedSites:true});
  assert.equal((await broker.claim()).job,null);
  await db.$executeRawUnsafe("TRUNCATE monitor_local_analysis_jobs CASCADE");
  await db.$executeRawUnsafe("UPDATE monitor_sites SET status='ACTIVE' WHERE host='paused.invalid'");
  assert.equal(await new Broker(db,{allowedHosts:['unit-test.invalid'],allowApprovedSites:true}).scan(),0);
});
test('the server config can switch approved-site access off again',async()=>{
  await importedPage('imported.invalid');
  let config={enabled:true,allowedHosts:['unit-test.invalid'],allowApprovedSites:false};
  const broker=await connect({allowApprovedSites:true,reload:()=>config});
  assert.equal((await broker.claim()).job,null);
  config={...config,allowApprovedSites:true};
  assert((await broker.claim()).job);
});
