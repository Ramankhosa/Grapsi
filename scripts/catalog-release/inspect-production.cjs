// Read-only inventory. Never print credentials or application secrets.
const fs = require('node:fs');
const cp = require('node:child_process');
const root = '/var/www/granter/Grapsi';
const dotenv = require(root + '/node_modules/dotenv');
let values = {};
for (const name of ['.env', '.env.production', '.env.local', '.env.production.local']) {
  const file = root + '/' + name;
  if (fs.existsSync(file)) Object.assign(values, dotenv.parse(fs.readFileSync(file)));
}
const u = new URL(values.DATABASE_URL);
const env = {...process.env, PGHOST:u.hostname, PGPORT:u.port||'5432', PGUSER:decodeURIComponent(u.username), PGPASSWORD:decodeURIComponent(u.password), PGDATABASE:decodeURIComponent(u.pathname.slice(1)), PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=30000'};
function sql(q) {return cp.execFileSync('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',q],{env,encoding:'utf8'}).trim();}
console.log('DATABASE', sql('SELECT current_database()'));
console.log('SERVER', sql('SHOW server_version'));
console.log('VECTOR', sql("SELECT extversion FROM pg_extension WHERE extname='vector'"));
console.log('DB_SIZE', sql('SELECT pg_size_pretty(pg_database_size(current_database()))'));
console.log('COUNTS', sql("SELECT relname,n_live_tup FROM pg_stat_user_tables WHERE relname IN ('funding_calls','call_assignments','grant_proposals','users','dsr_events') ORDER BY relname"));
console.log('MIGRATIONS', sql('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'));
console.log('FAILED_MIGRATIONS', sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL'));
const list=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'}));
const app=list.find(x=>x.name==='grantmentor');
if(app){
 const p=app.pm2_env;
 let runtimeDb=p.DATABASE_URL;
 console.log('APP',JSON.stringify({name:app.name,cwd:p.pm_cwd,status:p.status,port:p.PORT||null,hasRuntimeDatabase:!!runtimeDb,runtimeDatabaseMatchesFiles:runtimeDb ? runtimeDb===values.DATABASE_URL : null}));
}
