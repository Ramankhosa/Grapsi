# Seed Scripts

Production-ready seed scripts for the SpotiPR patent drafting system.

## Quick Start (Production)

```bash
# After running migrations
npx prisma migrate deploy

# Run all production seeds
node Seed/production-master-seed.js
```

## Master Seed Script

The `production-master-seed.js` orchestrates all seed scripts in the correct order.

### Usage

```bash
# Run all seeds
node Seed/production-master-seed.js

# Skip specific seeds
node Seed/production-master-seed.js --skip-plans
node Seed/production-master-seed.js --skip-countries
node Seed/production-master-seed.js --skip-llm
node Seed/production-master-seed.js --skip-users

# Only create users (for adding admins later)
node Seed/production-master-seed.js --users-only

# Help
node Seed/production-master-seed.js --help
```

### Seed Order

| Step | Script | Description |
|------|--------|-------------|
| 1 | `scripts/seed-production-plans.js` | Features, Tasks, LLMModelClass, Plans |
| 2 | `Countries/MasterSeed.js` | Country configs, section mappings, prompts |
| 3 | `Seed/seed-llm-models.js` | LLM models, workflow stages, plan configs |
| 4 | `scripts/setup-full-hierarchy.js` | Admin users, tenants, ATI tokens |

## Individual Scripts

### seed-llm-models.js

Seeds the flexible LLM model configuration system:

- **16 LLM Models**: Google (Gemini), OpenAI (GPT-4o, o1), Anthropic (Claude), DeepSeek, Groq
- **31 Workflow Stages**: Patent drafting, novelty search, diagram generation
- **Plan Model Configs**: Default model assignments per stage per plan

```bash
node Seed/seed-llm-models.js
```

### Paper Figure Planner stage controls

`Seed/seed-llm-models.js` now seeds the paper figure stages and generous limits directly:

- `PAPER_FIGURE_SUGGESTION`
- `PAPER_CHART_GENERATOR`
- `PAPER_DIAGRAM_GENERATOR`
- `PAPER_DIAGRAM_FROM_TEXT`
- `PAPER_SKETCH_GENERATION`

So for stage-limit issues, run this single script and restart your app process (PM2/systemd/docker):

```bash
node Seed/seed-llm-models.js
```

### create-tenant-admin.js

Creates admin users for existing tenants.

```bash
node Seed/create-tenant-admin.js
```

### reset-password.js

Resets password for a user.

```bash
node Seed/reset-password.js <email> <new-password>
```

## Notes

- All scripts are **idempotent** - safe to run multiple times
- Scripts use `upsert` operations to avoid duplicate data
- Check `.env` for admin credentials before running user creation
- Run `npx prisma migrate deploy` before seeding

## Complete Deployment Steps

```bash
# 1. Apply migrations
npx prisma migrate deploy

# 2. Run all seeds
node Seed/production-master-seed.js

# 3. Verify
npm run dev
# Login as superadmin (see .env for credentials)
# Visit /super-admin to verify configuration
```
