import dotenv from 'dotenv'

import { publicProjectCorpusService } from '../src/lib/publicProjects/service'

dotenv.config()

function readArg(name: string) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

async function main() {
  const limit = Number(readArg('limit') || 25)
  const includeFailed = !process.argv.includes('--skip-failed')
  const result = await publicProjectCorpusService.processPendingEmbeddings({
    limit,
    includeFailed,
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
