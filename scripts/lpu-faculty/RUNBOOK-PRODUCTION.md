# Production runbook — LPU faculty seed

Seeds 768 LPU researchers, ~138 org units, 35 unit heads and 2,320 influential
publications into an existing production tenant that already has members.

Rehearsed end to end on dev against a tenant with four ATI-token members
(OWNER / ADMIN / MANAGER / ANALYST), including deliberate email and employee-ID
collisions. Result: 766 created, 1 updated, 1 expected collision error, and no
pre-existing member modified.

**Target host layout** (from `scripts/deploy.sh`):

```
/var/www/granter/Grapsi     git checkout, served in place
pm2 app "grantmentor"       next start -p 3010
```

`npm ci` on this host installs dev dependencies, so `tsx` is present. No rebuild
and no PM2 restart is needed — nothing here touches `.next`, only the database.

---

## Before you start

You need:

- SSH access to the app host, and the ability to run `psql` / `pg_dump`
- The **ATI ID** of the LPU tenant (the one with the four ATI-token users)
- An **OWNER or ADMIN** login for that tenant — required for step 4, because
  `canGrantHeads` gates the 35 unit-head appointments to OWNER/ADMIN uploaders

---

## Step 0 — Back up the database

Not optional. This creates ~768 users and ~2,320 publication rows across five
tables; the rollback in this runbook is only safe if you have a dump to fall
back to.

```bash
cd /var/www/granter/Grapsi
export $(grep -E '^DATABASE_URL=' .env | xargs)
pg_dump "$DATABASE_URL" -Fc -f ~/grapsi-pre-lpu-seed-$(date +%Y%m%d-%H%M).dump
ls -lh ~/grapsi-pre-lpu-seed-*.dump
```

If a full dump is impractical, dump just the affected tables:

```bash
pg_dump "$DATABASE_URL" -Fc \
  -t users -t researcher_profiles -t tenant_org_units \
  -t org_unit_managers -t reference_library \
  -f ~/grapsi-pre-lpu-seed-tables-$(date +%Y%m%d-%H%M).dump
```

---

## Step 1 — Get the scripts onto the host

The pipeline scripts and `scripts/lpu-faculty/data/` are committed. Pulling is
enough — do NOT run `deploy.sh`, since no application code changed.

```bash
cd /var/www/granter/Grapsi
git fetch origin && git log --oneline -1 origin/main
git pull origin main
ls scripts/lpu-faculty/
```

You should see `01-aggregate.ts` through `08-preflight.ts`.

---

## Step 2 — Copy the two generated files

`scripts/lpu-faculty/out/` is gitignored (the repo ignores `out/`), so these do
not travel with the pull. Copy them from the machine that generated them:

```bash
scp scripts/lpu-faculty/out/lpu-faculty-roster-final.csv \
    scripts/lpu-faculty/out/lpu-influential-publications.json \
    <user>@<host>:/var/www/granter/Grapsi/scripts/lpu-faculty/out/
```

Confirm on the host — expect 769 lines (768 rows + header) and 855 researcher
entries:

```bash
cd /var/www/granter/Grapsi
wc -l scripts/lpu-faculty/out/lpu-faculty-roster-final.csv
grep -c '"employeeId"' scripts/lpu-faculty/out/lpu-influential-publications.json
```

---

## Step 3 — Pre-flight (read-only, writes nothing)

This is the gate. It reports any existing member whose email or employee ID
collides with a roster row, and exits non-zero if it finds one.

```bash
cd /var/www/granter/Grapsi
node ./node_modules/tsx/dist/cli.cjs scripts/lpu-faculty/08-preflight.ts --ati=<LPU_ATI_ID>
```

**Read the output before continuing.**

- `CLEAR — no collisions` → proceed to step 4.
- **EMAIL COLLISION** → an existing member shares an address with a roster row.
  The import would silently OVERWRITE their name, employee ID, school,
  department, research areas and summary. It does not error. Resolve first:
  change that person's email, or delete their row from the CSV.
- **EMPLOYEE ID COLLISION** → that roster row will be rejected and the
  researcher skipped. Safe, but they will be missing from the seed. Either free
  up the ID or accept the gap knowingly.

---

## Step 4 — Import the roster

Use the UI, not a script: `/tenant-admin/faculty` is the tested path and carries
auth plus an audit trail.

1. Sign in as **OWNER or ADMIN** of the LPU tenant.
2. Go to **/tenant-admin/faculty** → **Import CSV / Excel**.
3. Upload `lpu-faculty-roster-final.csv` with **Dry run** ticked.

Expected dry-run figures:

```
totalRows=768  created=~768  updated=0  errors=0
unitsCreated=~138  headsCreated=35  pendingActivation=~768  activationBlocked=0
```

`created` drops and `updated` rises by one for each pre-existing member the
roster matches — which pre-flight already told you about. `activationBlocked`
must be **0**; every row has an Employee ID.

4. If the numbers match, re-upload with **Dry run** off.

The roster deliberately carries **no Role column**. `facultyImportService` only
rewrites an existing user's roles when that column is present, so its absence
means the import cannot demote anyone already in the tenant. New users get the
ANALYST default.

---

## Step 5 — Seed the influential publications

The importer has no publication column, so these load separately, after the
accounts exist.

```bash
cd /var/www/granter/Grapsi
node ./node_modules/tsx/dist/cli.cjs scripts/lpu-faculty/04-seed-publications.ts \
  --tenant-id=<TENANT_ID> --dry-run
```

Then drop `--dry-run`. Expected: ~2,320 created, 0 skipped.

The script is **idempotent** — a second run creates nothing and skips everything.
It matches on employee ID **and** email together; if the wrong person holds a
roster employee ID it prints `REFUSED` and attaches nothing, rather than giving
one researcher's papers to another.

Every row is tagged `my-publication` **and** `synthetic-abstract`, because the
abstract text was inferred from the title and venue. It is not the published
abstract and carries a note saying so.

---

## Step 6 — Generate embeddings

Until this runs the profiles are inert: funding matching is entirely vector
search, so a seeded researcher matches nothing.

```bash
curl -X POST https://<your-host>/api/admin/funding/embeddings/backfill \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"target":"all","limit":100}'
```

Repeat until `missing` reaches 0 — the endpoint caps at 100 per call, so roughly
30+ calls for ~768 profiles plus ~2,320 publications. Check coverage from
**/super-admin/researcher-matching**.

Requires `VOYAGE_API_KEY` in the production environment.

---

## Step 7 — Verify

```bash
cd /var/www/granter/Grapsi
export $(grep -E '^DATABASE_URL=' .env | xargs)
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM users WHERE tenant_id = '<TENANT_ID>')            AS users,
    (SELECT COUNT(*) FROM users WHERE tenant_id = '<TENANT_ID>'
       AND password_hash IS NULL)                                           AS pending_activation,
    (SELECT COUNT(*) FROM tenant_org_units WHERE tenant_id = '<TENANT_ID>') AS org_units,
    (SELECT COUNT(*) FROM reference_library rl JOIN users u ON u.id = rl.user_id
       WHERE u.tenant_id = '<TENANT_ID>' AND 'my-publication' = ANY(rl.tags)) AS publications;
"
```

Then in the UI: **/tenant-admin/faculty** should list the roster with an
**Access** column showing Pending, and **/researcher-matching** should report a
researcher count with embedding coverage climbing.

---

## Rollback

Every seeded account has `password_hash IS NULL` — nobody has activated yet —
and `researcher_profiles`, `reference_library` and `org_unit_managers` all
cascade on user delete. So one statement removes the seed.

**Check first, then delete.** Replace the timestamp with the moment before your
import.

```sql
-- 1. See exactly what would go. Confirm the count looks like the seed.
SELECT COUNT(*) FROM users
WHERE tenant_id = '<TENANT_ID>'
  AND password_hash IS NULL
  AND created_at > '<YYYY-MM-DD HH:MM:SS>';

-- 2. Delete. Cascades to profiles, publications and head grants.
DELETE FROM users
WHERE tenant_id = '<TENANT_ID>'
  AND password_hash IS NULL
  AND created_at > '<YYYY-MM-DD HH:MM:SS>';
```

The `password_hash IS NULL` clause is the safety catch: it cannot touch your four
ATI-token members, who all have passwords set. Do not drop it.

Org units are left behind, harmless and empty. Remove them if you want:

```sql
DELETE FROM tenant_org_units u
WHERE u.tenant_id = '<TENANT_ID>'
  AND NOT EXISTS (SELECT 1 FROM researcher_profiles p WHERE p.org_unit_id = u.id);
```

If a pre-existing member's profile was overwritten by an email collision, that is
NOT recoverable by this delete — restore those fields from the step 0 dump.

---

## Open decision — placeholder emails

Addresses are `<employeeID>@lpu.co.in`, to be replaced with real ones later.

Two consequences worth deciding on before telling anyone to log in:

1. **Activation credentials are the same number twice.** First login at
   `/set-password` takes email + Employee ID, so `21975@lpu.co.in` + `21975`.
   Anyone who guesses a UID can claim that account. There is an 8-per-15-minute
   rate limit, but the ceiling is low. Prefer holding activation until real
   addresses land.

2. **A missing notification preference row counts as email ENABLED**
   (`fundingAlertService.ts:98`). Publishing a funding call today would attempt
   mail to all 768 placeholder addresses. To silence them until real addresses
   are in:

```sql
INSERT INTO researcher_notification_preferences
  (id, user_id, in_app_enabled, email_enabled, whatsapp_enabled,
   notification_frequency, digest_enabled, created_at, updated_at)
SELECT gen_random_uuid(), u.id, true, false, false, 'weekly', true, NOW(), NOW()
FROM users u
WHERE u.tenant_id = '<TENANT_ID>'
  AND u.password_hash IS NULL
ON CONFLICT (user_id) DO UPDATE SET email_enabled = false, updated_at = NOW();
```

Re-enable per user, or in bulk, once real addresses replace the placeholders.
