import dotenv from 'dotenv'

import {
  FUNDED_PROJECT_RAW_SOURCE_NAMES,
  runFundedProjectRawIngestion,
  type FundedProjectRawSourceName,
} from '../src/lib/fundedProjects/rawIngestion'
import { prisma } from '../src/lib/prisma'

dotenv.config()

function readArg(name: string) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

function readNumberArg(name: string, fallback: number) {
  const value = readArg(name)
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --${name} value: ${value}`)
  }
  return parsed
}

function readSources(): FundedProjectRawSourceName[] | undefined {
  const value = readArg('sources')
  if (!value) return undefined

  const requested = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const invalid = requested.filter(
    (source): source is string => !FUNDED_PROJECT_RAW_SOURCE_NAMES.includes(source as FundedProjectRawSourceName)
  )
  if (invalid.length) {
    throw new Error(`Unsupported source(s): ${invalid.join(', ')}. Supported: ${FUNDED_PROJECT_RAW_SOURCE_NAMES.join(', ')}`)
  }

  return requested as FundedProjectRawSourceName[]
}

async function main() {
  const result = await runFundedProjectRawIngestion({
    fromYear: readNumberArg('from-year', readNumberArg('since-year', 2015)),
    toYear: readArg('to-year') ? readNumberArg('to-year', new Date().getUTCFullYear()) : undefined,
    maxRecordsPerSource: readNumberArg('max-records-per-source', readNumberArg('max-per-source', 100)),
    pageSize: readNumberArg('page-size', 25),
    requestTimeoutMs: readNumberArg('timeout-ms', 30000),
    sources: readSources(),
  })

  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
