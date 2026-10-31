import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { parseTabularUpload, normalizeHeader } from '../src/lib/spreadsheet/parseTabularUpload'
import { reconcileFacultyRoster, type RosterFields, type ExistingFaculty, type RosterUnit } from '../src/lib/faculty/reconcileRoster'

async function main() {
  const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const file = arg('file'), tenantId = arg('tenant-id'), output = arg('out')
  if (!file || tenantId !== 'cmshc97c3005t6piv0y5c9c5n' || !output) throw Error('Use --file=<CSV/XLSX> --tenant-id=cmshc97c3005t6piv0y5c9c5n --out=<private-report.json>. This command previews LPU data only.')
  const sheet = parseTabularUpload(fs.readFileSync(file), file)
  const allowed: Record<string, keyof RosterFields> = { name: 'name', email: 'email', employeeid: 'employeeId', unitpath: 'unitPath',
    school: 'school', department: 'department', researchareas: 'researchAreas', keywords: 'keywords', researchsummary: 'researchSummary' }
  const headers = sheet.headers.map(normalizeHeader)
  if (!headers.includes('name') || !headers.includes('email')) throw Error('Name and Email columns are required. Use the prepared faculty template.')
  if (new Set(headers).size !== headers.length) throw Error('Duplicate column names must be reconciled before preview.')
  if (headers.some(h => ['role', 'accessrole', 'headof', 'headtitle', 'headscope'].includes(h))) throw Error('Remove access/leadership columns from this research-data batch.')
  if (sheet.rows.length > 5000) throw Error('Split this file into batches of 5,000 or fewer.')
  const rows = sheet.rows.map(row => {
    const value: RosterFields = { name: row.name || '', email: row.email || '' }
    for (const [header, key] of Object.entries(allowed)) if (headers.includes(header)) value[key] = row[header] || ''
    return value
  })
  const db = new PrismaClient()
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      if (!tenant) throw Error('The specified LPU tenant is not present in this database.')
      const people = await tx.$queryRaw<ExistingFaculty[]>`SELECT u.id,u.email,p.employee_id "employeeId",p.org_unit_id "unitId"
        FROM users u LEFT JOIN researcher_profiles p ON p.user_id=u.id WHERE u."tenantId"=${tenantId}`
      const units = await tx.$queryRaw<RosterUnit[]>`SELECT id,name,parent_id "parentId",is_active active FROM tenant_org_units WHERE tenant_id=${tenantId}`
      return { tenantId, tenantName: tenant.name, checkedAt: new Date().toISOString(), ...reconcileFacultyRoster(rows, people, units) }
    }, { timeout: 30000 })
    if (path.resolve(output) === path.resolve(file)) throw Error('Report must not overwrite the source roster.')
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify({ previewOnly: true, summary: result.summary, report: output }))
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Faculty preview failed.'); process.exitCode = 1 })
