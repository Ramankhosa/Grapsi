/**
 * Funding scheduler — fires the four cron-protected funding endpoints that are
 * otherwise inert. Run it as its own PM2 process next to the web app:
 *
 *   pm2 start scripts/funding-scheduler.js --name grapsi-funding-scheduler
 *   pm2 save
 *
 * Endpoints driven (all POST, authenticated with x-funding-alert-secret):
 *   /api/funding-dept/reminders/sweep   hourly   reminder ladder + escalations
 *   /api/funding/alerts/dispatch        hourly   healing sweep for undispatched published calls
 *   /api/funding/alerts/digest          daily + Monday   queued alert digests
 *   /api/funding-dept/reports/weekly    Monday   department digest to members + head
 *
 * Every endpoint is idempotent (unique-key claims, conditional updates, 5-day
 * digest stamps), so an overlapping or repeated fire is harmless — this script
 * only needs to be roughly on time, not exactly once.
 *
 * Configuration (env, falling back to the repo's .env):
 *   FUNDING_ALERT_CRON_SECRET   required — must match the web app's value
 *   FUNDING_SCHEDULER_BASE_URL  default http://127.0.0.1:3010
 *   FUNDING_DIGEST_HOUR         local hour for digests/weekly report, default 3
 *
 * Requires Node 18+ (global fetch). No dependencies, so PM2 can run it from a
 * plain checkout without a build step.
 */
const fs = require('fs')
const path = require('path')

function loadDotEnv() {
  const candidates = [
    process.env.GRAPSI_ENV_FILE,
    path.join(__dirname, '..', '.env.production'),
    path.join(__dirname, '..', '.env'),
  ].filter(Boolean)
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (key && process.env[key] === undefined) process.env[key] = value
      }
      console.log(`[funding-scheduler] loaded env from ${file}`)
      return
    } catch {
      // try the next candidate
    }
  }
}

loadDotEnv()

const BASE_URL = (process.env.FUNDING_SCHEDULER_BASE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '')
const SECRET = process.env.FUNDING_ALERT_CRON_SECRET || ''
const DIGEST_HOUR = Math.min(Math.max(Number(process.env.FUNDING_DIGEST_HOUR) || 3, 0), 23)
// Local hour for the once-daily source-monitor sweep. Separated from the
// digest hour so the watch can run before the working day while digests stay
// where operators expect them.
const MONITOR_HOUR = Math.min(Math.max(Number(process.env.FUNDING_MONITOR_HOUR) || 6, 0), 23)

if (!SECRET) {
  console.error(
    '[funding-scheduler] FUNDING_ALERT_CRON_SECRET is not set — the endpoints would reject every call. ' +
      'Set it in the environment (and the same value for the web app), then restart.'
  )
  process.exit(1)
}

async function post(route, body) {
  const url = `${BASE_URL}${route}`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-funding-alert-secret': SECRET,
      },
      body: JSON.stringify(body || {}),
    })
    const text = await response.text()
    const summary = text.length > 400 ? `${text.slice(0, 400)}…` : text
    if (!response.ok) {
      console.error(`[funding-scheduler] ${route} -> ${response.status}: ${summary}`)
    } else {
      console.log(`[funding-scheduler] ${route} -> ${response.status}: ${summary}`)
    }
  } catch (error) {
    console.error(`[funding-scheduler] ${route} failed: ${error.message}`)
  }
}

/**
 * Minute ticker with per-job "already ran this slot" stamps. Slot keys are
 * derived from the local clock, so a PM2 restart mid-slot can re-fire a job —
 * acceptable by design, since every endpoint is idempotent.
 */
const lastRun = new Map()

function due(key, slot) {
  if (lastRun.get(key) === slot) return false
  lastRun.set(key, slot)
  return true
}

function tick() {
  const now = new Date()
  const hourSlot = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`
  const daySlot = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const minute = now.getMinutes()

  // Hourly, offset a few minutes past the hour so top-of-hour restarts miss nothing.
  if (minute >= 5 && due('reminders', hourSlot)) {
    void post('/api/funding-dept/reminders/sweep')
  }
  if (minute >= 20 && due('alert-sweep', hourSlot)) {
    void post('/api/funding/alerts/dispatch')
  }

  // Daily digest, then the weekly bundle and department report on Mondays.
  if (now.getHours() === DIGEST_HOUR && minute >= 35 && due('daily-digest', daySlot)) {
    void post('/api/funding/alerts/digest', { frequency: 'daily' })
    if (now.getDay() === 1) {
      void post('/api/funding/alerts/digest', { frequency: 'weekly' })
      void post('/api/funding-dept/reports/weekly')
    }
  }

  // Daily hygiene: suspend EVENT users whose access window has ended.
  if (now.getHours() === DIGEST_HOUR && minute >= 50 && due('event-user-expiry', daySlot)) {
    void post('/api/platform/users/expire-event-access')
  }

  // The daily watch over monitored funder pages. Deliberately once a day and
  // early: calls found overnight are queued before anyone starts work, and a
  // daily rhythm is far gentler on the funders' servers than polling.
  if (now.getHours() === MONITOR_HOUR && minute >= 10 && due('monitor-sweep', daySlot)) {
    void post('/api/funding/monitor/sweep')
  }
}

console.log(
  `[funding-scheduler] started — target ${BASE_URL}, digests at ${String(DIGEST_HOUR).padStart(2, '0')}:35, ` +
    `source-monitor sweep at ${String(MONITOR_HOUR).padStart(2, '0')}:10 local time`
)
tick()
setInterval(tick, 60 * 1000)
