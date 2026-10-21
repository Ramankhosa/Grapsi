// Back up production and prove the dump restores into a separately named DB.
// Never restore into, migrate, or update the source database.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root='/var/www/granter/Grapsi';
const dotenv=require(root+'/node_modules/dotenv');
let values={};
for(const name of ['.env','.env.production','.env.local','.env.production.local']) {
 const file=path.join(root,name);if(fs.existsSync(file))Object.assign(values,dotenv.parse(fs.readFileSync(file)));
}
const url=new URL(values.DATABASE_URL),source=decodeURIComponent(url.pathname.slice(1));
if(source!=='grapsi'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Unexpected source database; refusing backup workflow');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,'').replace('T','_');
const scratch='grapsi_catalog_rehearsal_'+stamp;
if(!/^grapsi_catalog_rehearsal_\d{8}_\d{6}$/.test(scratch)||scratch===source)throw new Error('Unsafe scratch name');
const dir=path.join(root,'backups','catalog-release-'+stamp);fs.mkdirSync(dir,{mode:0o700});
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password)};
function run(exe,args){return cp.execFileSync(exe,args,{env,encoding:'utf8',maxBuffer:64*1024*1024});}
function sql(db,q){return run('psql',['-X','-At','-v','ON_ERROR_STOP=1','-d',db,'-c',q]).trim();}
const dump=path.join(dir,'production-before-release.dump');
console.log('Backing up',source,'to',dump);
run('nice',['-n','10','ionice','-c','3','pg_dump','--format=custom','--file='+dump,'--dbname='+source]);
const digest=crypto.createHash('sha256');const fd=fs.openSync(dump,'r');const buf=Buffer.alloc(1024*1024);let n;
while((n=fs.readSync(fd,buf,0,buf.length,null))>0)digest.update(buf.subarray(0,n));fs.closeSync(fd);
const sha256=digest.digest('hex');fs.writeFileSync(dump+'.sha256',sha256+'  '+path.basename(dump)+'\n',{mode:0o600});
console.log('Backup complete; SHA256',sha256);
sql('postgres','CREATE DATABASE "'+scratch+'"');
console.log('Restoring into separate database',scratch);
run('nice',['-n','10','ionice','-c','3','pg_restore','--exit-on-error','--no-owner','--no-privileges','--dbname='+scratch,dump]);
const checks={};
for(const table of ['funding_calls','call_assignments','grant_proposals','users','dsr_events']) {
 const production=sql(source,'SELECT count(*) FROM "'+table+'"');
 const restored=sql(scratch,'SELECT count(*) FROM "'+table+'"');
 checks[table]={production,restored};if(production!==restored)throw new Error('Counts changed for '+table+'; investigate concurrent work before proceeding');
}
const result={source,scratch,dump,sha256,checks,restoreVerified:true};
fs.writeFileSync(path.join(dir,'verified-backup.json'),JSON.stringify(result,null,2),{mode:0o600});
// Contains credentials, retained only locally on VM for the rehearsal checkout.
url.pathname='/'+scratch;
fs.writeFileSync(path.join(dir,'rehearsal.env'),Object.entries({...values,DATABASE_URL:url.toString()}).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify(result,null,2));
