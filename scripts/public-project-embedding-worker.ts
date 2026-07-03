import dotenv from 'dotenv'

import { runPublicProjectEmbeddingWorker } from '../src/lib/publicProjects/embeddingWorker'

dotenv.config()

function readArg(name: string) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

async function main() {
  const once = process.argv.includes('--once')
  const limit = readArg('limit')
  const pollInterval = readArg('poll-ms')
  const includeFailed =
    process.argv.includes('--include-failed') || (once && !process.argv.includes('--skip-failed'))

  const result = await runPublicProjectEmbeddingWorker({
    once,
    limit: limit ? Number(limit) : undefined,
    includeFailed,
    pollIntervalMs: pollInterval ? Number(pollInterval) : undefined,
  })

  if (once) {
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
