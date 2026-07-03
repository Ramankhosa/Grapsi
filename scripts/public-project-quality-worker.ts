import { runPublicProjectQualityJobs } from '../src/lib/publicProjects/qualityJobs'

function readFlag(name: string) {
  return process.argv.includes(name)
}

function readNumberFlag(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

async function main() {
  const result = await runPublicProjectQualityJobs({
    dedupe: readFlag('--dedupe'),
    enrich: readFlag('--enrich'),
    taxonomy: readFlag('--taxonomy'),
    dryRun: readFlag('--dry-run'),
    limit: readNumberFlag('--limit', 100),
  })
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    const { default: prisma } = await import('../src/lib/prisma')
    await prisma.$disconnect()
  })
