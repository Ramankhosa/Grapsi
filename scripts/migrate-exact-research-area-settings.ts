import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import prisma from '../src/lib/prisma'
import { exactOrganisationPlan,applyExactOrganisationItem } from '../src/lib/researchAreas/organisationReview'
async function main(){
 const args=process.argv.slice(2),arg=(key:string)=>args.find(a=>a.startsWith(key+'='))?.slice(key.length+1),target=arg('--confirm-target')
 const [{db}]=await prisma.$queryRaw<Array<{db:string}>>`SELECT current_database() db`
 assert(target&&db===target,'Supply the exact --confirm-target database');const rehearsal=/^grapsi_area_rehearsal_\d+$/.test(db);assert(db==='grapsi'||rehearsal,'Only Grapsi and its dedicated rehearsal are allowed')
 const plan=await exactOrganisationPlan(),summary={database:db,units:plan.length,ready:plan.filter(p=>p.newIds.length).length,unresolvedUnits:plan.filter(p=>p.unresolved.length).length,aiCalls:0,originalRowsRewritten:0}
 console.log(JSON.stringify(summary));const receipt=arg('--receipt');if(receipt)fs.writeFileSync(receipt,JSON.stringify({summary,plan},null,2),{mode:0o600});if(!args.includes('--apply'))return
 if(!rehearsal){assert(process.platform==='linux'&&fs.realpathSync(process.cwd())==='/var/www/granter/Grapsi');const proofFile=arg('--backup-proof');assert(proofFile&&fs.realpathSync(proofFile).startsWith('/var/www/granter/Grapsi/backups/uniform-areas-'));const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));assert(proof.database==='grapsi'&&proof.restoredAndVerified&&proof.classificationRehearsed);assert(Date.now()-Date.parse(proof.createdAt)<86400000);assert.equal(createHash('sha256').update(fs.readFileSync(proof.backupFile)).digest('hex'),proof.sha256)}
 const actor=arg('--actor');assert(actor,'An existing audited operator user ID is required');const user=await prisma.user.findUnique({where:{id:actor},select:{roles:true}});assert(user?.roles.includes('SUPER_ADMIN'),'Operator must be a superadmin')
 const applied=[];for(const item of plan)if(item.newIds.length)applied.push({unitId:item.unitId,revision:await applyExactOrganisationItem(item,actor)})
 if(receipt)fs.writeFileSync(receipt,JSON.stringify({summary,plan,applied},null,2),{mode:0o600});console.log(JSON.stringify({applied:applied.length,unresolvedUnits:summary.unresolvedUnits,aiCalls:0}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Exact conversion failed');process.exitCode=1}).finally(()=>prisma.$disconnect())
