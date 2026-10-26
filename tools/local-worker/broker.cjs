'use strict';
// A pull-only RPC broker over the caller's existing IAM-authenticated SSH session.
// No HTTP listener, database credentials on clients, or arbitrary commands.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('./policy.cjs');
const Previous=require('./policy-1.1.0.cjs');
const {hasReusableGeneral}=require('./general-reuse.cjs');
const LEASE_SECONDS=120, MAX_ATTEMPTS=5;
class ProtocolError extends Error {constructor(code,message){super(message);this.code=code;}}
const check=(condition,code,message)=>{if(!condition)throw new ProtocolError(code,message);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
class Broker {
  constructor(db,options={}){this.db=db;this.enabled=options.enabled!==false;this.allowedHosts=options.allowedHosts??['anrfonline.in','onlinedst.gov.in'];this.reload=options.reload;this.worker=null;this.legacy=false;this.closed=false;this.lastScan=0;this.skipTable=false;}
  async rules(db=this.db){
    const present=await db.$queryRawUnsafe("SELECT to_regclass('public.monitor_skip_rules')::text AS name");this.skipTable=Boolean(present[0]?.name);
    return this.skipTable?db.$queryRawUnsafe('SELECT site_id,dedup_key,match FROM monitor_skip_rules WHERE expires_at IS NULL OR expires_at>now()'):[];
  }
  refresh(){if(this.reload){const config=this.reload();this.enabled=config.enabled!==false;if(config.allowedHosts)this.allowedHosts=config.allowedHosts;}}
  async hello(input){
    this.refresh();check([1,P.PROTOCOL].includes(input.protocol),'UPGRADE_REQUIRED','This worker requires a compatible application version.');
    this.legacy=input.protocol===1||input.appVersion!==P.APP_VERSION;
    const clientPolicy=input.protocol===1?{POLICY_HASH:P.LEGACY_POLICY_HASH,TEMPLATE:P.LEGACY_TEMPLATE}:input.appVersion===Previous.APP_VERSION?Previous:P;
    check(uuid(input.workerId),'INVALID_REQUEST','A valid device identifier is required.');
    check(input.modelSha256===P.MODEL.sha256,'MODEL_MISMATCH','The approved model must be verified before connecting.');
    check(input.protocol===1||[P.APP_VERSION,Previous.APP_VERSION].includes(input.appVersion),'UPGRADE_REQUIRED','Install the current local worker.');
    const name=String(input.displayName??'Windows worker').slice(0,120).replace(/[\x00-\x1f]/g,'');
    await this.db.$executeRawUnsafe(`INSERT INTO monitor_local_workers(id,display_name,app_version,model_sha256,state) VALUES($1,$2,$3,$4,'IDLE') ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,app_version=excluded.app_version,model_sha256=excluded.model_sha256,last_seen_at=now(),state='IDLE'`,input.workerId,name,String(input.appVersion??'unknown').slice(0,40),input.modelSha256);
    this.worker=input.workerId;
    return {protocol:input.protocol,server:'Grapsi Source Watch',serverTime:new Date().toISOString(),mode:'SHADOW',enabled:this.enabled,policyHash:clientPolicy.POLICY_HASH,model:P.MODEL,promptTemplate:clientPolicy.TEMPLATE,types:P.TYPES,leaseSeconds:LEASE_SECONDS,pollSeconds:15,approvedHosts:this.allowedHosts};
  }
  async touch(state='IDLE'){
    check(this.worker,'NOT_REGISTERED','Connect this worker first.');
    await this.db.$executeRawUnsafe('UPDATE monitor_local_workers SET last_seen_at=now(),state=$2 WHERE id=$1',this.worker,state);
  }
  async scan(){
    if(!this.enabled||Date.now()-this.lastScan<30000)return 0;
    this.lastScan=Date.now();
    const rules=await this.rules();
    const skipGuard=this.skipTable?"AND NOT EXISTS(SELECT 1 FROM monitor_skip_rules k WHERE k.site_id=r.site_id AND (k.expires_at IS NULL OR k.expires_at>now()) AND (k.dedup_key=r.dedup_key OR (k.match='FOLDER' AND (starts_with(r.dedup_key,rtrim(k.dedup_key,'/') || '/') OR starts_with(r.dedup_key,k.dedup_key || '?')))))":'';
    const rows=await this.db.$queryRawUnsafe(`SELECT r.id,r.site_id,r.current_version_id,r.title,r.canonical_url AS url,r.dedup_key,v.text,v.truncated,v.raw_hash,v.meaningful_hash,s.host
      FROM monitor_resources r JOIN monitor_sites s ON s.id=r.site_id JOIN monitor_resource_versions v ON v.id=r.current_version_id AND v.resource_id=r.id
      WHERE s.status='ACTIVE' AND s.host=ANY($1::text[]) AND v.text IS NOT NULL AND r.canonical_url IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM monitor_local_analysis_jobs j WHERE j.version_id=v.id AND j.policy_hash=$2)
      AND NOT ${hasReusableGeneral('r','v','$2','$3')}
      ${skipGuard}
      ORDER BY r.last_observed_at DESC LIMIT 150`,this.allowedHosts,P.POLICY_HASH,P.MODEL.sha256);
    if(!rows.length)return 0;
    let added=0;
    for(const row of rows){
      if(!P.publicUrl(row.url,row.host)||P.skipped(row.dedup_key,rules.filter(r=>r.site_id===row.site_id)))continue;
      const payload=P.makePayload(row);
      const inputHash=P.sha256(JSON.stringify(payload));
      added+=await this.db.$executeRawUnsafe(`INSERT INTO monitor_local_analysis_jobs(id,resource_id,version_id,policy_hash,input_hash,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(version_id,policy_hash) DO NOTHING`,crypto.randomUUID(),row.id,row.current_version_id,P.POLICY_HASH,inputHash,JSON.stringify(payload));
    }
    return added;
  }
  async sweep(){
    await this.retireUnchanged();
    await this.db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET state='SUPERSEDED',updated_at=now() WHERE state='QUEUED' AND policy_hash<>$1",P.POLICY_HASH);
    await this.db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs j SET state='SUPERSEDED',lease_until=NULL,updated_at=now() WHERE state IN ('QUEUED','RUNNING') AND NOT EXISTS(SELECT 1 FROM monitor_resources r WHERE r.id=j.resource_id AND r.current_version_id=j.version_id)");
    await this.db.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET state=CASE WHEN attempts >= $1 THEN 'FAILED' ELSE 'QUEUED' END,lease_until=NULL,available_at=now(),last_error='Lease expired; device unavailable',updated_at=now() WHERE state='RUNNING' AND lease_until<now()",MAX_ATTEMPTS);
  }
  async retireUnchanged(db=this.db){
    return db.$executeRawUnsafe(`UPDATE monitor_local_analysis_jobs j SET state='SUPERSEDED',last_error='Identical source evidence; existing local result retained',updated_at=now()
      WHERE j.state='QUEUED' AND EXISTS(SELECT 1 FROM monitor_resources r JOIN monitor_resource_versions v ON v.id=r.current_version_id
        WHERE r.id=j.resource_id AND ${hasReusableGeneral('r','v','$1','$2')})`,P.POLICY_HASH,P.MODEL.sha256);
  }
  async claim(){
    check(!this.legacy,'UPGRADE_REQUIRED',`Saved results can upload, but new analysis requires worker ${P.APP_VERSION}.`);
    this.refresh();await this.touch();if(!this.enabled)return {job:null,paused:true};
    await this.scan();await this.rules();
    const skipGuard=this.skipTable?"AND NOT EXISTS(SELECT 1 FROM monitor_skip_rules k WHERE k.site_id=r.site_id AND (k.expires_at IS NULL OR k.expires_at>now()) AND (k.dedup_key=r.dedup_key OR (k.match='FOLDER' AND (starts_with(r.dedup_key,rtrim(k.dedup_key,'/') || '/') OR starts_with(r.dedup_key,k.dedup_key || '?')))))":'';
    return this.db.$transaction(async tx=>{
      await this.retireUnchanged(tx);
      // These leases are independent of the live crawler's per-site lease.
      await tx.$executeRawUnsafe(`UPDATE monitor_local_analysis_jobs SET state='FAILED',lease_until=NULL,last_error='Retry limit reached',updated_at=now() WHERE state='RUNNING' AND lease_until<now() AND attempts >= $1`,MAX_ATTEMPTS);
      await tx.$executeRawUnsafe(`UPDATE monitor_local_analysis_jobs j SET state='SUPERSEDED',lease_until=NULL,updated_at=now() WHERE j.state IN ('QUEUED','RUNNING') AND NOT EXISTS(SELECT 1 FROM monitor_resources r WHERE r.id=j.resource_id AND r.current_version_id=j.version_id)`);
      // Device-level serialization also protects two launches on separate sessions.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))','local-worker:'+this.worker);
      const busy=await tx.$queryRawUnsafe(`SELECT id FROM monitor_local_analysis_jobs WHERE state='RUNNING' AND owner=$1 AND lease_until>now() LIMIT 1`,this.worker);
      if(busy.length)return {job:null,busy:true};
      const token=crypto.randomUUID();
      const rows=await tx.$queryRawUnsafe(`WITH candidate AS (
        SELECT j.id FROM monitor_local_analysis_jobs j JOIN monitor_resources r ON r.id=j.resource_id JOIN monitor_sites s ON s.id=r.site_id JOIN monitor_resource_versions v ON v.id=r.current_version_id
        WHERE ((j.state='QUEUED' AND j.available_at<=now()) OR (j.state='RUNNING' AND j.lease_until<now())) AND j.attempts<$1
          AND j.policy_hash=$2 AND s.status='ACTIVE' AND s.host=ANY($3::text[]) AND r.current_version_id=j.version_id
          AND NOT ${hasReusableGeneral('r','v','$2','$6')}
          ${skipGuard}
        ORDER BY CASE WHEN coalesce((j.payload->>'queuePriority')::int,100)<10 THEN 0
          WHEN EXISTS(SELECT 1 FROM monitor_opportunities o WHERE o.primary_resource_id=r.id AND o.field_evidence->'payload'->'fields'->'close_date'->>'status'='supported' AND o.field_evidence->'payload'->'fields'->'close_date'->>'value' BETWEEN to_char(current_date,'YYYY-MM-DD') AND to_char(current_date+7,'YYYY-MM-DD')) THEN 10
          WHEN coalesce((j.payload->>'queuePriority')::int,100)<=20 THEN 20
          WHEN j.created_at<now()-interval '6 hours' THEN 30 WHEN j.payload->'page'->>'text' ~* 'deadline|closes|extension|corrigendum' THEN 40 ELSE 100 END,j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED)
        UPDATE monitor_local_analysis_jobs j SET state='RUNNING',owner=$4,lease_token=$5,lease_until=now()+interval '120 seconds',attempts=attempts+1,updated_at=now()
        FROM candidate c WHERE j.id=c.id RETURNING j.id,j.input_hash,j.payload,j.lease_token,j.lease_until`,MAX_ATTEMPTS,P.POLICY_HASH,this.allowedHosts,this.worker,token,P.MODEL.sha256);
      if(!rows.length)return {job:null};
      const row=rows[0];
      // A laptop may return days after discovery. Judge deadlines as of claim time,
      // and bind the refreshed date to this lease's input hash.
      const today=P.dateInIndia();
      if(row.payload.asOfDate!==today){
        row.payload={...row.payload,asOfDate:today};row.input_hash=P.sha256(JSON.stringify(row.payload));
        await tx.$executeRawUnsafe('UPDATE monitor_local_analysis_jobs SET payload=$2::jsonb,input_hash=$3 WHERE id=$1',row.id,JSON.stringify(row.payload),row.input_hash);
      }
      await tx.$executeRawUnsafe("UPDATE monitor_local_workers SET state='BUSY',last_seen_at=now() WHERE id=$1",this.worker);
      return {job:{id:row.id,inputHash:row.input_hash,leaseToken:row.lease_token,leaseUntil:row.lease_until,payload:row.payload}};
    },{timeout:15000});
  }
  async heartbeat(input){
    await this.touch(input.jobId?'BUSY':'IDLE');
    if(!input.jobId)return {alive:true};
    check(uuid(input.jobId)&&uuid(input.leaseToken),'INVALID_REQUEST','Invalid lease.');
    const changed=await this.db.$executeRawUnsafe(`UPDATE monitor_local_analysis_jobs j SET lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 AND owner=$2 AND lease_token=$3 AND state='RUNNING' AND lease_until>now() AND EXISTS(SELECT 1 FROM monitor_resources r JOIN monitor_sites s ON s.id=r.site_id WHERE r.id=j.resource_id AND r.current_version_id=j.version_id AND s.status='ACTIVE')`,input.jobId,this.worker,input.leaseToken);
    return {held:changed===1};
  }
  async complete(input){
    this.refresh();await this.touch();
    check(uuid(input.jobId)&&uuid(input.leaseToken),'INVALID_REQUEST','Invalid lease.');
    check(P.TYPES.includes(input.decision),'INVALID_RESULT','Invalid classification.');
    check(input.modelSha256===P.MODEL.sha256&&[P.POLICY_HASH,Previous.POLICY_HASH,P.LEGACY_POLICY_HASH].includes(input.policyHash),'INVALID_RESULT','Model or policy does not match.');
    check(Number.isInteger(input.elapsedMs)&&input.elapsedMs>=0&&input.elapsedMs<=300000,'INVALID_RESULT','Invalid processing duration.');
    return this.db.$transaction(async tx=>{
      const rows=await tx.$queryRawUnsafe(`SELECT j.*,r.current_version_id,r.dedup_key AS resource_key,r.site_id,s.status AS site_status,s.host,v.text AS current_text,v.raw_hash AS current_raw_hash FROM monitor_local_analysis_jobs j JOIN monitor_resources r ON r.id=j.resource_id JOIN monitor_sites s ON s.id=r.site_id JOIN monitor_resource_versions v ON v.id=j.version_id WHERE j.id=$1 FOR UPDATE OF j,r,s,v`,input.jobId);
      check(rows.length,'NOT_FOUND','The job is no longer available.');const job=rows[0];
      check(input.policyHash===job.policy_hash,'INVALID_RESULT','The result policy does not match this job.');
      const validator=input.policyHash===P.POLICY_HASH?P:input.policyHash===Previous.POLICY_HASH?Previous:null;
      const details=validator?validator.validateDetails(input.details,job.payload.page):{};
      const resultHash=P.sha256(P.stable({decision:input.decision,details}));
      check(job.owner===this.worker&&job.lease_token===input.leaseToken&&job.input_hash===input.inputHash,'LEASE_LOST','This result belongs to a different task version or lease.');
      if(job.state==='DONE'){
        const saved=await tx.$queryRawUnsafe('SELECT decision,result_hash FROM monitor_local_analysis_results WHERE job_id=$1',job.id);
        check(saved[0]?.decision===input.decision&&(!saved[0].result_hash||saved[0].result_hash===resultHash),'RESULT_CONFLICT','A different result was already accepted.');
        return {accepted:true,duplicate:true,mode:'SHADOW',details};
      }
      check(job.state==='RUNNING'&&new Date(job.lease_until)>new Date(),'LEASE_LOST','The job lease expired; it can be retried.');
      if(job.current_version_id!==job.version_id||job.site_status!=='ACTIVE'||!this.allowedHosts.includes(job.host)||P.sha256(job.current_text??'')!==job.payload.fullTextHash||job.current_raw_hash!==job.payload.sourceHash){
        await tx.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET state='SUPERSEDED',lease_until=NULL,updated_at=now() WHERE id=$1",job.id);
        return {accepted:false,stale:true};
      }
      const ruleRows=(await this.rules(tx)).filter(rule=>rule.site_id===job.site_id);
      if(P.skipped(job.resource_key,ruleRows)){
        await tx.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET state='SUPERSEDED',lease_until=NULL,updated_at=now() WHERE id=$1",job.id);return {accepted:false,stale:true};
      }
      await tx.$executeRawUnsafe(`INSERT INTO monitor_local_analysis_results(job_id,resource_id,version_id,worker_id,input_hash,policy_hash,model_sha256,decision,elapsed_ms,details,result_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,job.id,job.resource_id,job.version_id,this.worker,job.input_hash,job.policy_hash,P.MODEL.sha256,input.decision,input.elapsedMs,JSON.stringify(details),resultHash);
      await tx.$executeRawUnsafe("UPDATE monitor_local_analysis_jobs SET state='DONE',lease_until=NULL,updated_at=now() WHERE id=$1",job.id);
      return {accepted:true,duplicate:false,mode:'SHADOW',details};
    },{timeout:15000});
  }
  async release(input){
    await this.touch('PAUSED');check(uuid(input.jobId)&&uuid(input.leaseToken),'INVALID_REQUEST','Invalid lease.');
    const changed=await this.db.$executeRawUnsafe(`UPDATE monitor_local_analysis_jobs SET state=CASE WHEN attempts >= $4 THEN 'FAILED' ELSE 'QUEUED' END,lease_until=NULL,available_at=now()+interval '30 seconds',last_error=$5,updated_at=now() WHERE id=$1 AND owner=$2 AND lease_token=$3 AND state='RUNNING'`,input.jobId,this.worker,input.leaseToken,MAX_ATTEMPTS,String(input.reason??'Worker paused').slice(0,300));
    return {released:changed===1};
  }
  async status(){
    await this.touch();
    const jobs=await this.db.$queryRawUnsafe('SELECT state,count(*)::int AS count FROM monitor_local_analysis_jobs GROUP BY state');
    const results=await this.db.$queryRawUnsafe('SELECT decision,count(*)::int AS count FROM monitor_local_analysis_results GROUP BY decision');
    const recent=await this.db.$queryRawUnsafe(`SELECT a.decision,a.details,a.created_at,r.title,r.canonical_url AS url,a.elapsed_ms FROM monitor_local_analysis_results a JOIN monitor_resources r ON r.id=a.resource_id ORDER BY a.created_at DESC LIMIT 10`);
    return {mode:'SHADOW',enabled:this.enabled,jobs,results,recent};
  }
  async dispatch(request){
    check(request&&typeof request==='object'&&!Array.isArray(request),'INVALID_REQUEST','Invalid request.');
    const input=request.data??{};
    if(request.action==='hello')return this.hello(input);
    check(this.worker,'NOT_REGISTERED','Connect this worker first.');
    const allowed={claim:()=>this.claim(),heartbeat:()=>this.heartbeat(input),complete:()=>this.complete(input),release:()=>this.release(input),status:()=>this.status()};
    check(Object.hasOwn(allowed,request.action),'INVALID_REQUEST','Unknown operation.');return allowed[request.action]();
  }
}
function loadDb(appRoot){
  const resolve=name=>require.resolve(name,{paths:[appRoot]});
  const dotenv=require(resolve('dotenv'));
  // Match the existing production loader; no environment values are logged.
  for(const name of ['.env','.env.production','.env.local','.env.production.local']){
    const filename=path.join(appRoot,name);if(fs.existsSync(filename))Object.assign(process.env,dotenv.parse(fs.readFileSync(filename)));
  }
  const {PrismaClient}=require(resolve('@prisma/client'));return new PrismaClient({log:[]});
}
async function initialize(db){
  const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('local-worker-schema-1',0))");
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
  },{timeout:30000});
  await db.$executeRawUnsafe("ALTER TABLE monitor_local_analysis_results ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb");
  await db.$executeRawUnsafe('ALTER TABLE monitor_local_analysis_results ADD COLUMN IF NOT EXISTS result_hash varchar(64)');
}
async function stdio(broker,input=process.stdin,output=process.stdout){
  // A bounded line parser closes the transport before an unbounded line can accumulate.
  let buffer='',queue=Promise.resolve(),closing=false;
  const write=value=>{if(!output.destroyed)output.write(JSON.stringify(value)+'\n');};
  await new Promise((resolve,reject)=>{
    input.setEncoding('utf8');
    input.on('data',chunk=>{
      if(closing)return;buffer+=chunk;
      if(Buffer.byteLength(buffer)>65536){closing=true;input.pause();write({id:null,ok:false,error:{code:'REQUEST_TOO_LARGE',message:'Request limit exceeded.'}});queue.finally(resolve);return;}
      let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
        queue=queue.then(async()=>{let request;try{request=JSON.parse(line);const data=await broker.dispatch(request);write({id:request.id??null,ok:true,data});}catch(error){write({id:request?.id??null,ok:false,error:{code:error.code??'SERVER_ERROR',message:error instanceof ProtocolError?error.message:'Production could not process this request. Please retry.'}});if(!(error instanceof ProtocolError))process.stderr.write('Local worker operation failed: '+(error.code??error.name)+'\n');}});
      }
    });
    input.on('end',()=>{closing=true;queue.then(resolve,reject)});input.on('error',reject);
  });
}
async function main(){
  const configPath=process.env.GRAPSI_LOCAL_WORKER_CONFIG||'/etc/grapsi-local-worker.json';
  const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
  const db=loadDb(config.appRoot??'/var/www/granter/Grapsi');
  try{
    if(process.argv.includes('--init')){await initialize(db);console.log('Local worker schema ready.');return;}
    if(process.argv.includes('--enqueue')){
      const broker=new Broker(db,{enabled:config.enabled!==false,allowedHosts:config.allowedHosts});
      await broker.sweep();const added=await broker.scan();console.log(JSON.stringify({enqueued:added,mode:'SHADOW'}));return;
    }
    if(process.argv.includes('--status')){
      const jobs=await db.$queryRawUnsafe('SELECT state,count(*)::int AS count FROM monitor_local_analysis_jobs GROUP BY state');
      const results=await db.$queryRawUnsafe('SELECT decision,count(*)::int AS count FROM monitor_local_analysis_results GROUP BY decision');
      console.log(JSON.stringify({mode:'SHADOW',jobs,results},null,2));return;
    }
    check(process.argv.includes('--stdio'),'INVALID_REQUEST','Use --stdio, --init or --status.');
    await stdio(new Broker(db,{enabled:config.enabled!==false,allowedHosts:config.allowedHosts,reload:()=>fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):config}));
  }finally{await db.$disconnect();}
}
if(require.main===module)main().catch(error=>{process.stderr.write('Local worker broker could not start: '+(error instanceof ProtocolError?error.message:error.code??error.name)+'\n');process.exitCode=1;});
module.exports={Broker,ProtocolError,initialize,stdio,loadDb,LEASE_SECONDS,MAX_ATTEMPTS};
