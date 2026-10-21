// Exercise actual phase functions with failed external commands, never a DB.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const source=fs.readFileSync('scripts/catalog-release/release.sh','utf8').replace(/\r\n/g,'\n');
const logging=source.slice(source.indexOf('c_blue='),source.indexOf('while [ $# -gt 0 ]'));
const functions=source.slice(source.indexOf('app() {'),source.indexOf('# ------------------------------------------------------------------ driver'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grapsi-phase-failures-'));
const quote=s=>"'"+s.replace(/'/g,"'\"'\"'")+"'";
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
try {
 fs.mkdirSync(path.join(dir,'scripts'));fs.writeFileSync(path.join(dir,'scripts/deploy.sh'),'#!/usr/bin/env bash\nexit 74\n');
 const base='set -Eeuo pipefail\n'+logging+'\n'+functions+'\n'+`
APP_DIR=${quote(dir)}
BUNDLE_DIR=$APP_DIR
RUN_DIR=$APP_DIR
SNAPSHOT_DIR=$APP_DIR
DB_NAME=scratch
PGURL=unused
MANIFEST=unused
GIT_REF=''
CONFIRM_DB=''
OPERATOR_EMAIL=operator
SKIP_DEPLOY=0
SKIP_EMBED=0
ENV_FILES=()
TSX=(node unused)
PRISMA=(node unused)
app() { return 71; }
q() { return 72; }
dump() { return 73; }
confirm() { return 0; }
node() { return 75; }
psql() { return 72; }
pg_dump() { return 73; }
git() { return 76; }
`;
 for(const phase of ['preflight','backup','migrate','deploy','seed','dryrun','import','release','embed','verify','backfill']) {
  const test=path.join(dir,'test.sh');fs.writeFileSync(test,base+`\nCURRENT_PHASE=${phase}\n"phase_$CURRENT_PHASE"\necho SHOULD_NOT_REACH\n`);
  const result=cp.spawnSync(bash,[test],{encoding:'utf8'});
  assert.notEqual(result.status,0,phase);assert.match(result.stdout+result.stderr,new RegExp('--from '+phase),phase);
  assert.doesNotMatch(result.stdout,/SHOULD_NOT_REACH/);console.log('PASS failure stops and prints resume hint:',phase);
 }
 // The driver must accept the preflight resume hint printed before any phase.
 assert.match(source,/\[ "\$FROM" = preflight \]/);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
