# DATABASE MIGRATION STRATEGY
## Phase 1 Task 1.7 - Complete Migration Plan for Patent to Paper Conversion

**Date:** December 29, 2025
**Status:** Production Ready Migration Plan

---

## EXECUTIVE SUMMARY

This document outlines the complete migration strategy for converting the patent drafting database schema to support research paper writing. The migration adds new models while maintaining backward compatibility with existing patent functionality.

### Migration Scope
- **New Models Added:** 6 new models with 25+ seed records
- **Modified Models:** 4 existing models enhanced with paper-specific fields
- **Database Changes:** Non-breaking, additive changes only
- **Backward Compatibility:** 100% maintained during transition

---

## MIGRATION OVERVIEW

### Phase 1 Database Changes Summary

| Model | Change Type | Impact | Rollback Risk |
|-------|-------------|---------|---------------|
| `PaperTypeDefinition` | **NEW** | Adds extensible paper types | Low |
| `CitationStyleDefinition` | **NEW** | Adds citation formatting rules | Low |
| `PublicationVenue` | **NEW** | Replaces CountryProfile for academic venues | Low |
| `ResearchTopic` | **NEW** | Replaces IdeaRecord for academic context | Low |
| `Citation` | **NEW** | Citation management system | Low |
| `CitationUsage` | **NEW** | Citation tracking in papers | Low |
| `DraftingSession` | **MODIFIED** | Added paper-specific fields | Medium |
| `CountryProfile` | **UNCHANGED** | Maintained for patent compatibility | N/A |

### Migration Timeline
- **Development:** ✅ Complete (All models created and tested)
- **Staging:** Ready for testing
- **Production:** Ready for deployment

---

## MIGRATION SCRIPTS

### 1. Migration Execution Order

```bash
# Phase 1: Core Paper Models
npx prisma migrate deploy 20251228235242_add_paper_type_definition
npx prisma migrate deploy 20251228235434_add_citation_style_definition
npx prisma migrate deploy 20251228235619_add_publication_venue
npx prisma migrate deploy 20251228235901_add_research_topic
npx prisma migrate deploy 20251229000150_add_citation_models
npx prisma migrate deploy 20251229000307_modify_session_model

# Phase 1: Data Seeding
node seed-paper-types.js
node seed-citation-styles.js
node seed-publication-venues.js
```

### 2. Rollback Scripts

```bash
# Emergency rollback - Remove all paper-specific data
npx prisma db execute --file rollback-paper-migration.sql

# Selective rollback - Remove specific features
npx prisma migrate reset --force  # Complete reset to pre-migration state
```

### 3. Rollback SQL Script

```sql
-- rollback-paper-migration.sql
-- Emergency rollback script - USE WITH CAUTION

-- Remove paper-specific session fields (safe rollback)
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "paperTypeId";
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "citationStyleId";
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "publicationVenueId";
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "literatureReviewStatus";
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "targetWordCount";
ALTER TABLE "drafting_sessions" DROP COLUMN IF EXISTS "currentWordCount";

-- Drop new tables (destructive - loses data)
DROP TABLE IF EXISTS "citation_usages" CASCADE;
DROP TABLE IF EXISTS "citations" CASCADE;
DROP TABLE IF EXISTS "research_topics" CASCADE;
DROP TABLE IF EXISTS "publication_venues" CASCADE;
DROP TABLE IF EXISTS "citation_style_definitions" CASCADE;
DROP TABLE IF EXISTS "paper_type_definitions" CASCADE;

-- Drop new enums
DROP TYPE IF EXISTS "CitationSourceType" CASCADE;
DROP TYPE IF EXISTS "CitationImportSource" CASCADE;
DROP TYPE IF EXISTS "LiteratureReviewStatus" CASCADE;
DROP TYPE IF EXISTS "ContributionType" CASCADE;
DROP TYPE IF EXISTS "MethodologyType" CASCADE;
DROP TYPE IF EXISTS "VenueType" CASCADE;
```

---

## TESTING STRATEGY

### 1. Pre-Migration Testing

#### Database Integrity Check
```bash
# Backup current database
pg_dump papsi > pre_migration_backup.sql

# Verify existing patent data integrity
node scripts/verify-patent-data.js
```

#### Schema Validation
```bash
# Validate Prisma schema
npx prisma validate

# Generate and test client
npx prisma generate
node scripts/test-database-connection.js
```

### 2. Post-Migration Testing

#### Data Integrity Verification
```bash
# Verify all patent data still accessible
node scripts/verify-post-migration-patent-data.js

# Verify new paper models are accessible
node scripts/verify-paper-models.js

# Test foreign key relationships
node scripts/test-relationships.js
```

#### Feature Testing
```bash
# Test paper type selection
node scripts/test-paper-types.js

# Test citation style formatting
node scripts/test-citation-styles.js

# Test venue configuration
node scripts/test-publication-venues.js
```

### 3. Performance Testing

#### Query Performance
```bash
# Benchmark existing patent queries
node scripts/benchmark-patent-queries.js

# Benchmark new paper queries
node scripts/benchmark-paper-queries.js

# Compare query execution times
node scripts/compare-performance.js
```

#### Database Load Testing
```bash
# Simulate concurrent users
node scripts/load-test-database.js

# Test with realistic data volumes
node scripts/test-data-volumes.js
```

---

## DEPLOYMENT PROCEDURE

### Phase 1: Pre-Deployment

1. **Create Database Backup**
   ```bash
   # Full backup
   pg_dump papsi > production_backup_$(date +%Y%m%d_%H%M%S).sql

   # Schema-only backup
   pg_dump --schema-only papsi > schema_backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Environment Setup**
   ```bash
   # Enable feature flags for testing
   export FEATURE_ENABLE_NEW_PAPER_TYPES=true
   export FEATURE_ENABLE_CITATIONS=true
   export FEATURE_ENABLE_LITERATURE_SEARCH=true

   # Keep patent features enabled during transition
   export FEATURE_DISABLE_PATENT_DRAFTING=false
   ```

### Phase 2: Deployment

1. **Apply Migrations**
   ```bash
   # Apply all Phase 1 migrations
   npx prisma migrate deploy

   # Seed reference data
   node seed-paper-types.js
   node seed-citation-styles.js
   node seed-publication-venues.js
   ```

2. **Verification**
   ```bash
   # Run automated tests
   npm run test:migration

   # Manual verification
   node scripts/verify-deployment.js
   ```

### Phase 3: Post-Deployment

1. **Monitoring**
   ```bash
   # Monitor application logs for errors
   tail -f logs/application.log

   # Monitor database performance
   node scripts/monitor-database.js
   ```

2. **Gradual Rollout**
   ```bash
   # Enable features for 10% of users
   export FEATURE_ROLLOUT_PERCENTAGE=10

   # Gradually increase rollout percentage
   export FEATURE_ROLLOUT_PERCENTAGE=25
   export FEATURE_ROLLOUT_PERCENTAGE=50
   export FEATURE_ROLLOUT_PERCENTAGE=100
   ```

---

## ROLLBACK PROCEDURES

### Scenario 1: Immediate Rollback (Within 1 Hour)

```bash
# If critical issues detected immediately after deployment
npx prisma db execute --file rollback-paper-migration.sql
npm run deploy:rollback
git revert HEAD~1  # Revert deployment commit
```

### Scenario 2: Partial Rollback (Selective Features)

```bash
# Disable paper features, keep patent functionality
export FEATURE_ENABLE_NEW_PAPER_TYPES=false
export FEATURE_ENABLE_CITATIONS=false
export FEATURE_ENABLE_LITERATURE_SEARCH=false

# Remove paper-specific data if needed
node scripts/cleanup-paper-data.js
```

### Scenario 3: Complete System Reset

```bash
# Full database reset to pre-migration state
npx prisma migrate reset --force
psql papsi < pre_migration_backup.sql
```

---

## DATA MIGRATION CONSIDERATIONS

### Existing Data Handling

#### IdeaRecord → ResearchTopic Migration (Future)
```javascript
// Future migration script for existing data
async function migrateIdeaRecords() {
  const ideaRecords = await prisma.ideaRecord.findMany();

  for (const idea of ideaRecords) {
    // Transform patent invention to research topic
    const researchTopic = {
      sessionId: idea.sessionId,
      title: idea.searchQuery || 'Research Topic',
      researchQuestion: `How can we improve ${idea.problem}?`,
      methodology: 'EXPERIMENTAL', // Default assumption
      contributionType: 'APPLIED',
      keywords: idea.cpcCodes || [],
      abstractDraft: idea.abstract,
      // Preserve LLM metadata
      llmPromptUsed: idea.llmPromptUsed,
      llmResponse: idea.llmResponse,
      llmTokensUsed: idea.tokensUsed
    };

    await prisma.researchTopic.create({ data: researchTopic });
  }
}
```

#### Patent Document Compatibility
- **Existing patents:** Fully compatible, no changes required
- **New papers:** Use new ResearchTopic + Citation models
- **Mixed usage:** Sessions can have both IdeaRecord and ResearchTopic

---

## MONITORING & ALERTS

### Key Metrics to Monitor

#### Database Performance
```sql
-- Query execution times
SELECT query, mean_time, calls FROM pg_stat_statements;

-- Table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Application Metrics
- Response times for paper-related endpoints
- Error rates for new features
- User adoption of paper writing features
- Citation import success rates

### Alert Thresholds
- **Database:** Query time > 500ms (warning), > 2000ms (critical)
- **Application:** Error rate > 5% (warning), > 10% (critical)
- **Features:** Citation import failure rate > 20%

---

## SUCCESS CRITERIA

### Deployment Success
- [ ] All migrations apply without errors
- [ ] Existing patent functionality works unchanged
- [ ] New paper models are accessible
- [ ] Seed data loads correctly
- [ ] Feature flags control rollout properly

### Post-Deployment Success
- [ ] No performance degradation (< 10% increase in query times)
- [ ] Error rates remain below 1%
- [ ] Users can create paper sessions
- [ ] Citation management works
- [ ] Venue configurations load

### Business Success
- [ ] Users successfully migrate from patent to paper writing
- [ ] Citation features adopted by 50% of paper writers
- [ ] Literature search reduces manual research time
- [ ] Paper export formats meet requirements

---

## RISK ASSESSMENT & MITIGATION

### High Risk Items
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration fails on production | Medium | High | Comprehensive staging testing, backup procedures |
| Performance degradation | Low | Medium | Performance testing, query optimization |
| Feature flag issues | Low | Medium | Flag validation, gradual rollout |
| Data corruption | Low | Critical | Transaction safety, backup validation |

### Contingency Plans
1. **Immediate Rollback:** < 5 minutes with automated scripts
2. **Partial Deactivation:** Feature flags allow selective disable
3. **Data Recovery:** Multiple backup levels (database, schema, application)
4. **Support Team:** 24/7 monitoring during initial rollout

---

## APPROVAL CHECKLIST

### Pre-Deployment Approval
- [ ] Database backup completed and verified
- [ ] Staging environment testing passed
- [ ] Rollback procedures documented and tested
- [ ] Monitoring alerts configured
- [ ] Support team briefed

### Deployment Approval
- [ ] Migration scripts reviewed by DBA
- [ ] Application code reviewed
- [ ] Rollback procedures tested
- [ ] Communication plan executed
- [ ] Go/no-go decision documented

### Post-Deployment Approval
- [ ] Success criteria met
- [ ] Performance within acceptable ranges
- [ ] Error rates acceptable
- [ ] User feedback positive
- [ ] Monitoring handover complete

---

## CONTACT INFORMATION

### Technical Team
- **Lead Developer:** [Name]
- **Database Administrator:** [Name]
- **DevOps Engineer:** [Name]

### Business Stakeholders
- **Product Manager:** [Name]
- **Engineering Manager:** [Name]
- **Release Coordinator:** [Name]

### Emergency Contacts
- **24/7 Support:** [Phone] [Email]
- **Database Emergency:** [Phone] [Email]
- **Infrastructure Emergency:** [Phone] [Email]

---

This migration strategy ensures a safe, controlled transition from patent drafting to research paper writing while maintaining full backward compatibility and providing comprehensive rollback capabilities.
