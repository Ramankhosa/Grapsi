/**
 * Source Watch v2 worker.
 *
 *   npm run worker:source-monitor            run until stopped (PM2: grapsi-monitor-worker)
 *   npm run worker:source-monitor -- --once  drain what is runnable now, then exit
 *
 * Env: MONITOR_WORKER_CONCURRENCY (default 4), MONITOR_BROWSER_ENABLED=true to
 * render JavaScript-built listings, MONITOR_BROWSER_CONCURRENCY (default 1).
 */
import dotenv from 'dotenv'

dotenv.config()
// Marks this process as the worker: the browser tier refuses to load anywhere else.
process.env.MONITOR_WORKER_PROCESS = '1'

function readArg(name: string) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

async function main() {
  const { runSourceMonitorWorker } = await import('../src/lib/monitor/worker')
  const once = process.argv.includes('--once')
  const concurrency = readArg('concurrency')
  const result = await runSourceMonitorWorker({
    once,
    concurrency: concurrency ? Number(concurrency) : undefined,
    pollMs: readArg('poll-ms') ? Number(readArg('poll-ms')) : undefined,
  })
  if (once) console.log(JSON.stringify({ executed: result.executed }))
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
