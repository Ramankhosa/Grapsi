# Production deploy (GCP VM: 12 GB RAM / 4 vCPU, Linux)

Zero-downtime deploys that never delete the running build.

## Why this changed

The old flow was `npm run build`, which runs `scripts/clean-next.js` — it
**deletes the live ~1.2 GB `.next` directory that the running server is serving
from**, then rebuilds it in place. On a GCP persistent disk that delete-then-
rewrite of ~1 GB of small files is a huge burst of IOPS. When it saturated the
disk's I/O, the running app stalled waiting on disk and stopped responding.

The new flow (`npm run deploy`) fixes this:

- The live app is served from a **separate `current/` directory**, so a build
  never touches or deletes it.
- The build runs under `nice` + `ionice` (idle CPU/IO priority) so it can't
  starve the running server.
- A new build is assembled into a fresh `releases/<timestamp>/` dir; we then
  **atomically repoint a symlink and `pm2 reload`** (cluster mode → workers
  restart one at a time → no dropped requests).
- If the new release is unhealthy, the deploy **auto-rolls back** to the previous
  release. Old releases are **kept** for instant manual rollback.

Memory was never the issue (12 GB is plenty for `next build`); this is purely
about disk I/O and not disturbing the live process.

## One-time server setup

```bash
# 1. Process manager
sudo npm install -g pm2

# 2. Directory layout (served app lives OUTSIDE the git checkout)
sudo mkdir -p /srv/grapsi/{releases,shared,logs}
sudo chown -R "$USER" /srv/grapsi

# 3. Put the repo somewhere to build from, e.g.:
git clone <repo-url> /srv/grapsi/repo
cd /srv/grapsi/repo
npm ci

# 4. Runtime secrets — persistent, survives deploys, symlinked into each release.
#    PM2 loads these into every worker (see ecosystem.config.js).
cp .env.production.example /srv/grapsi/shared/.env.production   # then edit real values
#    (DATABASE_URL, API keys, etc.)

# 5. Persistent writable state (if the app writes to ./uploads)
mv /srv/grapsi/repo/uploads /srv/grapsi/shared/uploads 2>/dev/null || mkdir -p /srv/grapsi/shared/uploads

# 6. First deploy (starts PM2)
cd /srv/grapsi/repo
GIT_PULL=1 npm run deploy

# 7. Make PM2 restart on reboot
pm2 startup    # run the command it prints
pm2 save
```

Point your fronting layer (nginx or the GCP load balancer) at
`127.0.0.1:3010`, using `/api/health` as the health check path.

## Deploying a change

```bash
cd /srv/grapsi/repo
GIT_PULL=1 npm run deploy
```

What it does: fetch + reset to `origin/main` → `prisma generate` → incremental
`next build` (low I/O priority) → assemble `releases/<ts>` → swap `current` →
`pm2 reload` → health-check `/api/health` → auto-rollback if unhealthy.

Useful env overrides:

| Variable | Default | Purpose |
|---|---|---|
| `GIT_PULL` | `0` | `1` = fetch + `git reset --hard $GIT_REF` before building |
| `GIT_REF` | `origin/main` | ref to deploy when `GIT_PULL=1` |
| `INSTALL` | `auto` | `1` = force `npm ci`; `0` = never; `auto` = only if `node_modules` missing |
| `RELEASES_TO_KEEP` | `0` | `0` = keep ALL old builds; `N` = keep newest N (current is never pruned) |
| `HEALTH_TIMEOUT` | `60` | seconds to wait for `/api/health` before rollback |
| `APP_ROOT` | `/srv/grapsi` | base path for `releases/`, `current`, `shared/`, `logs/` |
| `WEB_INSTANCES` | `2` | PM2 cluster workers (used by `ecosystem.config.js`) |

## Rollback

Old builds are retained, so rollback is instant (no rebuild):

```bash
npm run rollback            # go to the previous release
npm run rollback -- --list  # list available releases
npm run rollback 20260708120000   # go to a specific release
```

## Disk management (important with `RELEASES_TO_KEEP=0`)

By request, the default keeps **every** old release for rollback. Each release
is a small standalone artifact (not the full 1.2 GB `.next`), but they still add
up. Bound it once you're comfortable:

```bash
RELEASES_TO_KEEP=5 npm run deploy   # keep the 5 newest, prune older
```

`current` is never pruned. Pruning only ever removes releases older than the
newest N.

## GCP-specific notes

- **Disk I/O was the outage cause.** GCP persistent-disk IOPS/throughput scale
  with disk *size* and *type*. If builds still feel I/O-heavy, use `pd-balanced`
  or `pd-ssd` and/or a larger disk. The deploy already `ionice`s the build so it
  yields to the live server.
- **Even lower impact:** build off the VM (CI or a build box) and copy the
  assembled release over. Everything here (standalone artifact + symlink swap +
  `pm2 reload`) works the same whether the build ran locally or was rsync'd in.
- **Never run `npm run build` on the production box** — it still calls
  `clean-next` and will delete the live `.next`. Always use `npm run deploy`
  (which uses the incremental `build:cached` into a fresh release).
- **Multiple dev servers:** the machine was also running several `next dev`
  servers (per the `.codex-next-dev-*` logs). Keep those off the production VM;
  their file-watchers and recompiles compete for the same disk.

## Health endpoint

`GET /api/health` → `200 { "status": "ok", ... }`. Dependency-free (no DB), so a
struggling database can't make the process look down and trigger a needless
restart. Used by the deploy health-gate and suitable for nginx / GCP LB checks.
```

## Build time: what costs what, and the knobs

A cold `next build` here compiles 110 App Router pages, 467 route handlers and
~1,570 source files, so it is inherently a multi-minute job. These switches drop
the phases the production box does not need. All of them default to the fast
setting for `scripts/deploy.sh`; a plain local `npm run build` still does
everything.

| Knob | Default | What it does |
| --- | --- | --- |
| `NEXT_OUTPUT_STANDALONE` | unset | `1` emits `.next/standalone` **and** re-enables `outputFileTracing`. Only the `releases/` + `ecosystem.config.js` layout runs that server. The live box runs `next start` from the checkout and never reads it, so tracing every server file through ~1.7 GB of `node_modules` and copying the result was the longest phase of the build for nothing. |
| `NEXT_SKIP_CHECKS` | `1` in `safe-build.sh` | Skips the in-build ESLint and TypeScript passes. The type pass re-checks ~1,750 files and has to chew through the 26 MB Prisma client declaration file that 232 models and 131 enums generate. Run `npm run lint` and `npx tsc --noEmit` where the code is written instead. Set `NEXT_SKIP_CHECKS=0` to keep them in the build. |
| `BUILD_NICE` | `5` | CPU priority of the build. Was `10`, the floor, which on a box also running the live app and the sibling patentnest app stretched the wall time badly. `0` for the fastest build, `10` if a deploy visibly slows the site. |
| `BUILD_IONICE` | `5` | Same for disk priority (`ionice -c2 -n$BUILD_IONICE`). |

Two other things that used to cost minutes and are now gone:

- **The build cache is moved, not copied.** `safe-build.sh` hands `.next/cache`
  to `.next.incoming` with a rename instead of a >1 GB `cp -a` at the lowest IO
  priority. Next keys its webpack cache on the Next version and the config, not
  on `distDir`, so a cache built as `.next` stays valid as `.next.incoming`. On
  a failed build a trap moves it straight back.
- **`experimental.optimizeCss` is off.** Critters was inlining 1.8 kB of a
  285 kB stylesheet, i.e. nothing, at ~130 ms on each of 218 prerendered pages.

**Editing `next.config.js` invalidates the entire webpack cache.** Next registers
the config file as a webpack build dependency, so the first build after any
config change is a cold one. Expect the usual slow build once, then fast ones.

To see where the time actually went, run this in the repo after a build:

```bash
node -e 'const s={};require("fs").readFileSync(".next/trace","utf8").trim().split("\n").forEach(l=>{try{JSON.parse(l).forEach(x=>{if(!x.parentId)s[x.name]=(s[x.name]||0)+x.duration})}catch(e){}});Object.entries(s).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([n,d])=>console.log((d/1e6).toFixed(1).padStart(8)+"s  "+n))'
```
