# Comprehensive Database Seed Script

This script provides a complete solution for backing up and seeding the SpotIPR database with all necessary data for development and testing.

## Features

- **Full Data Export**: Exports all database tables to JSON files before seeding
- **Complete Seeding**: Seeds user hierarchy, plans, features, country data, and sample data
- **Flexible Options**: Export-only mode, skip export, or full seeding
- **Backup Safety**: All existing data is preserved in `database-backup/` folder

## Usage

### Export Current Database (Safe)
```bash
npm run db:export
# or
node scripts/comprehensive-seed.js --export-only
```

This exports all current data to `database-backup/` folder without making any changes.

### Full Seed (After Reset)
```bash
npm run db:seed:comprehensive
# or
node scripts/comprehensive-seed.js
```

This exports all data, then seeds the database with:
- User hierarchy (Super Admin, Tenant Admin, Analyst)
- Plans, features, and LLM access rules
- Country profiles and section mappings
- Sample projects, patents, and idea bank ideas

### Skip Export During Seed
```bash
node scripts/comprehensive-seed.js --skip-export
```

## What Gets Seeded

### User Hierarchy
- **Super Admin**: `superadmin@spotipr.com` / `SuperSecure123!`
- **Tenant Admin**: `tenantadmin@spotipr.com` / `TenantAdmin123!`
- **Analyst**: `analyst@spotipr.com` / `AnalystPass123!`

### Plans & Features
- **FREE_PLAN**: Basic prior art search and patent drafting
- **PRO_PLAN**: Full features including diagrams and idea bank
- **ENTERPRISE_PLAN**: Advanced features with highest limits

### Country Data
- Country profiles from JSON files in `Countries/` folder
- Section mappings from `Countries/Finalmapping.csv`
- Country names and continents from `Countries/countryname.csv`

### Sample Data
- Sample projects and patents
- Idea bank ideas for testing
- Complete user hierarchy with proper tenant assignments

## Database Reset Workflow

When you need to reset the database:

1. **Export current data** (recommended):
   ```bash
   npm run db:export
   ```

2. **Reset database** (if needed):
   ```bash
   npx prisma migrate reset --force
   # or manually drop/recreate database
   ```

3. **Run comprehensive seed**:
   ```bash
   npm run db:seed:comprehensive
   ```

## Backup Location

All exported data is saved to:
```
database-backup/
├── export-summary.json    # Summary of exported records
├── tenant.json           # Tenant data
├── user.json            # User data
├── countryProfile.json  # Country profiles
├── countrySectionMapping.json  # Section mappings
└── ... (all other tables)
```

## Recovery

If you need to restore from backup, the JSON files contain all the data needed for manual restoration or custom import scripts.

## Security Notes

- Passwords are properly hashed using bcrypt
- ATI tokens are generated securely
- All sensitive data is handled appropriately

## Troubleshooting

### Migration Issues
If you encounter migration issues, try:
```bash
npx prisma migrate reset --force
npm run db:seed:comprehensive
```

### Export Errors
If export fails on certain tables, check that the database is accessible and all tables exist.

### CSV Parsing Issues
Ensure `Countries/Finalmapping.csv` and `Countries/countryname.csv` are properly formatted.

## Dependencies

Requires `csv-parser` package for CSV processing:
```bash
npm install csv-parser --save
```
