'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {loadDb}=require('./broker.cjs');
async function main(){
 process.umask(0o077);
 const appRoot='/var/www/granter/Grapsi',db=loadDb(appRoot);
 try{
  const folder=path.join(__dirname,'prisma','migrations'),targets=['20261024150000_local_analysis_worker','20261025100000_local_titles_and_shared_extraction','20261025110000_monitor_coverage_gaps'];
  const applied=await db.$queryRawUnsafe('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations');
  const known=new Set(applied.filter(r=>r.finished_at&&!r.rolled_back_at).map(r=>r.migration_name));
  const pending=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).filter(n=>!known.has(n));
  if(pending.some(n=>!targets.includes(n)))throw Error('Unexpected pending migration; deployment stopped.');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=path.join(appRoot,'backups','local-worker-'+stamp);fs.mkdirSync(backup,{mode:0o700});
  const url=new URL(process.env.DATABASE_URL);
  const dump=cp.spawnSync('pg_dump',['--schema-only','--no-owner','--file',path.join(backup,'schema-before.sql')],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))},encoding:'utf8'});
  if(dump.status!==0)throw Error('Schema backup failed; no migration applied.');
  const prisma=require.resolve('prisma/build/index.js',{paths:[appRoot]});
  const migration=cp.spawnSync(process.execPath,[prisma,'migrate','deploy','--schema',path.join(__dirname,'prisma','schema.prisma')],{env:process.env,encoding:'utf8'});
  fs.writeFileSync(path.join(backup,'migration.log'),migration.stdout+'\n'+migration.stderr,{mode:0o600});
  if(migration.status!==0)throw Error('Migration failed; inspect the protected deployment log.');
  const tables=await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'monitor_local_%' ORDER BY tablename");
  if(tables.length!==3)throw Error('Analysis tables were not created.');
  console.log(JSON.stringify({installed:true,backup,tables:tables.map(r=>r.tablename)}));
 }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
