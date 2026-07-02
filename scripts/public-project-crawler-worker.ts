import dotenv from 'dotenv'

import { runPublicProjectCrawlerWorker } from '../src/lib/publicProjects/worker'

dotenv.config()

function readArg(name: string) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

async function main() {
  const once = process.argv.includes('--once')
  const runId = readArg('run-id') || undefined
  const maxItems = readArg('max-items')
  const pollInterval = readArg('poll-ms')

  const result = await runPublicProjectCrawlerWorker({
    once,
    runId,
    maxItems: maxItems ? Number(maxItems) : undefined,
    pollIntervalMs: pollInterval ? Number(pollInterval) : undefined,
  })

  if (once) {
    console.log(JSON.stringify({ processed: result ? result.id : null }, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
