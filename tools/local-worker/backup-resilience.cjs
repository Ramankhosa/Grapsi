'use strict';
// Deployment helper: protected full backup, restore and additive migration rehearsal.
process.umask(0o077);
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root='/var/www/granter/Grapsi',run=root+'/backups/source-watch-resilience-20261025-01',stage=run+'/checkout';
const {loadDb}=require('/opt/grapsi-local-worker/current/broker.cjs');const db=loadDb(root);
const source=new URL(process.env.DATABASE_URL),cloneName='grapsi_sw_resilience_rehearsal_20261025_test';
const pgEnv={...process.env,PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:decodeURIComponent(source.pathname.slice(1))};
function command(bin,args,log,env=pgEnv){const fd=fs.openSync(path.join(run,log),'w',0o600);try{cp.execFileSync(bin,args,{cwd:stage,env,stdio:['ignore',fd,fd]})}finally{fs.closeSync(fd)}}
function rehearseTests(clone){
 const testEnv={...process.env,MONITOR_TEST_DATABASE_URL:clone.href,PLAYWRIGHT_BROWSERS_PATH:'/var/lib/grapsi-source-watch/browsers'};
 for(const key of Object.keys(testEnv))if(key.startsWith('MONITOR_')&&key!=='MONITOR_TEST_DATABASE_URL')delete testEnv[key];
 for(const key of ['GOOGLE_AI_API_KEY','GOOGLE_API_KEY','ANTHROPIC_API_KEY','ZHIPU_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY'])delete testEnv[key];
 testEnv.MONITOR_STORAGE_ROOT=run+'/rehearsal-storage';
 command('nice',['-n10',process.execPath,'node_modules/vitest/vitest.mjs','run','--config','vitest.monitor-integration.config.ts'],'rehearsal-tests.log',testEnv);
 fs.writeFileSync(run+'/BACKUP_REHEARSED',JSON.stringify({at:new Date().toISOString(),commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:stage,encoding:'utf8'}).trim()}));console.log('RESTORE_MIGRATIONS_AND_TESTS_PASSED');
}
async function main(){try{
 if(process.argv.includes('--retest')){if(fs.readFileSync(run+'/rehearsal-database','utf8').trim()!==cloneName)throw Error('Wrong rehearsal database');const clone=new URL(source);clone.pathname='/'+cloneName;command(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],'rehearsal-migrate.log',{...process.env,DATABASE_URL:clone.href});rehearseTests(clone);return;}
 if(!fs.existsSync(stage+'/node_modules/.prisma/client/index.js'))throw Error('Stage dependencies must be ready');
 if(fs.existsSync(run+'/BACKUP_REHEARSED'))throw Error('Rehearsal already completed');
 const applied=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
 const known=new Set(applied.map(r=>r.migration_name)),allowed=new Set(['20261025100000_local_titles_and_shared_extraction','20261025110000_monitor_coverage_gaps']);
 const pending=fs.readdirSync(stage+'/prisma/migrations',{withFileTypes:true}).filter(d=>d.isDirectory()&&!known.has(d.name)).map(d=>d.name);
 if(pending.length!==2||pending.some(n=>!allowed.has(n)))throw Error('Unexpected pending migrations');
 console.log('PROTECTED_BACKUP_STARTED');
 if(!fs.existsSync(run+'/database.dump'))command('nice',['-n10','pg_dump','--format=custom','--no-owner','--no-acl','--file='+run+'/database.dump'],'backup.log');
 command('pg_restore',['--list',run+'/database.dump'],'backup-manifest.txt');
 console.log('BACKUP_VERIFIED_BYTES',fs.statSync(run+'/database.dump').size);
 const existing=await db.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1',cloneName);if(existing.length)throw Error('Rehearsal database already exists; inspect before retrying');
 await db.$executeRawUnsafe('CREATE DATABASE "'+cloneName+'" TEMPLATE template0');fs.writeFileSync(run+'/rehearsal-database',cloneName);
 console.log('RESTORING_REHEARSAL_DATABASE');
 command('nice',['-n10','pg_restore','--exit-on-error','--no-owner','--no-acl','--dbname='+cloneName,run+'/database.dump'],'restore.log');
 const clone=new URL(source);clone.pathname='/'+cloneName;
 command(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],'rehearsal-migrate.log',{...process.env,DATABASE_URL:clone.href});
 rehearseTests(clone);
}finally{await db.$disconnect()}}
main().catch(e=>{console.error('Backup/rehearsal stopped:',e.code||e.message);process.exitCode=1});
