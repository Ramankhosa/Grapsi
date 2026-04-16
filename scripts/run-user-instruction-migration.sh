#!/bin/bash

# Migration script for user instruction persistence
# Run this on production BEFORE deploying the new code

set -e  # Exit on any error

echo "=========================================="
echo "User Instruction Persistence Migration"
echo "=========================================="

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    echo "Please set it before running this script:"
    echo "  export DATABASE_URL='postgresql://user:pass@host:5432/dbname'"
    exit 1
fi

echo ""
echo "⚠️  This will modify the user_section_instructions table"
echo "⚠️  Make sure you have a database backup before proceeding!"
echo ""
read -p "Have you backed up the database? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Please backup your database first:"
    echo "  pg_dump -U your_user -d your_database > backup_\$(date +%Y%m%d_%H%M%S).sql"
    exit 1
fi

echo ""
echo "Running migration..."
echo ""

# Run the migration SQL
psql "$DATABASE_URL" -f prisma/migrations/20241228_user_instruction_persistence/migration.sql

echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "Next steps:"
echo "1. Deploy your updated code"
echo "2. Run: npx prisma generate"
echo "3. Restart your application"
echo ""

