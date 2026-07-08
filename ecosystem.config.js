/**
 * PM2 process definition for the production Next.js server.
 *
 * We run the Next.js *standalone* server (`server.js`, produced by
 * `output: 'standalone'`) in cluster mode. Cluster mode is what makes
 * `pm2 reload` a true zero-downtime reload: PM2 restarts the workers one at a
 * time, so at least one worker is always serving while the others swap to the
 * new build.
 *
 * `cwd` points at the release symlink (`current`). Deploys assemble a new
 * release directory, atomically repoint `current` at it, then run
 * `pm2 reload ecosystem.config.js` — the running app is never stopped and the
 * live build directory is never deleted.
 *
 * Override paths/port via environment variables if your layout differs:
 *   APP_ROOT (default /srv/grapsi), PORT (default 3010), WEB_INSTANCES (default 2).
 */
const fs = require('fs');
const path = require('path');

const APP_ROOT = process.env.APP_ROOT || '/srv/grapsi';
const PORT = process.env.PORT || '3010';
const INSTANCES = process.env.WEB_INSTANCES || 2; // 4 vCPU box → 2 leaves headroom for build/db

// Load the app's runtime secrets (DATABASE_URL, API keys, ...) from the shared
// env file so PM2 injects them into every worker. Kept in `shared/` so it
// survives deploys and is never inside a release directory. A minimal parser
// avoids adding a dotenv dependency to the process manager.
function loadSharedEnv() {
  const envPath =
    process.env.GRAPSI_ENV_FILE || path.join(APP_ROOT, 'shared', '.env.production');
  const out = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch (error) {
    // File may be absent on first setup — the app can still boot with whatever
    // is already in the environment.
    console.warn(`[ecosystem] could not read ${envPath}: ${error.message}`);
  }
  return out;
}

const sharedEnv = loadSharedEnv();

module.exports = {
  apps: [
    {
      name: 'grapsi',
      cwd: `${APP_ROOT}/current`,
      script: 'server.js', // Next standalone entrypoint (current/server.js)
      exec_mode: 'cluster',
      instances: INSTANCES,

      // Zero-downtime reload tuning.
      wait_ready: false, // Next standalone does not emit 'ready'; PM2 waits for listen
      listen_timeout: 15000, // give a fresh worker up to 15s to bind the port
      kill_timeout: 10000, // let in-flight requests drain for up to 10s on shutdown

      // Safety rails. 12 GB box, so this only guards against a genuine leak.
      max_memory_restart: '1500M',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,

      env: {
        // App secrets from shared/.env.production first...
        ...sharedEnv,
        // ...then the process-level settings (these win).
        NODE_ENV: 'production',
        PORT,
        HOSTNAME: '0.0.0.0',
        NEXT_TELEMETRY_DISABLED: '1',
      },

      // Logs live outside the release dirs so rotating/deleting releases never
      // touches them.
      out_file: `${APP_ROOT}/logs/grapsi-out.log`,
      error_file: `${APP_ROOT}/logs/grapsi-error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
