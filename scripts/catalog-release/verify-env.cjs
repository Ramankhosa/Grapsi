const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grapsi-env-test-'));
try {
 fs.symlinkSync(path.resolve('node_modules'),path.join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const token="spaces 'quote' $HOME `echo unsafe` # hash \\ slash";
 fs.writeFileSync(path.join(dir,'.env'),'DATABASE_URL=postgresql://localhost/scratch\nTOKEN='+JSON.stringify(token)+'\n');
 const out=path.join(dir,'resolved.env');
 const env={...process.env};delete env.DATABASE_URL;delete env.TOKEN;
 cp.execFileSync(process.execPath,['scripts/catalog-release/lib/env.mjs',dir,out],{env});
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
 const actual=cp.execFileSync(bash,['-c','. "$1"; printf "%s" "$TOKEN"','test',out],{encoding:'utf8'});
 // dotenv preserves backslashes in double-quoted values except newline escapes.
 const expected=require('dotenv').parse(fs.readFileSync(path.join(dir,'.env'))).TOKEN;
 assert.equal(actual,expected);
 fs.writeFileSync(path.join(dir,'.env.production'),'DATABASE_URL=postgresql://localhost/different\n');
 const mismatched=cp.spawnSync(process.execPath,['scripts/catalog-release/lib/env.mjs',dir,out],{env,encoding:'utf8'});
 assert.equal(mismatched.status,2);assert.match(mismatched.stderr,/DIFFERENT databases/);
 console.log('PASS environment shell quoting and database mismatch refusal');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
