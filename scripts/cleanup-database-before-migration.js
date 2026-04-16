// Script to clean up database before removing EMBEDDINGS and RERANK enum values
// This must be run BEFORE updating the schema to avoid enum constraint errors

const { PrismaClient } = require('@prisma/client');

async function cleanupDatabaseBeforeMigration() {
  const prisma = new PrismaClient();

  try {
    console.log('🧹 Cleaning up database before schema migration...');

    // First, let's check what features exist
    const allFeatures = await prisma.$queryRaw`
      SELECT id, code FROM "Feature"
    `;

    console.log('Current features in database:');
    allFeatures.forEach(feature => {
      console.log(`  - ${feature.code} (ID: ${feature.id})`);
    });

    // Find EMBEDDINGS and RERANK features
    const embeddingsFeature = allFeatures.find(f => f.code === 'EMBEDDINGS');
    const rerankFeature = allFeatures.find(f => f.code === 'RERANK');

    // Clean up EMBEDDINGS feature
    if (embeddingsFeature) {
      console.log('\n🗑️  Removing EMBEDDINGS feature and related data...');

      // Delete in correct order (respecting foreign key constraints)
      const planFeaturesDeleted = await prisma.$executeRaw`
        DELETE FROM "PlanFeature" WHERE "featureId" = ${embeddingsFeature.id}
      `;
      console.log(`  - Deleted ${planFeaturesDeleted} PlanFeature records`);

      const usageMetersDeleted = await prisma.$executeRaw`
        DELETE FROM "UsageMeter" WHERE "featureId" = ${embeddingsFeature.id}
      `;
      console.log(`  - Deleted ${usageMetersDeleted} UsageMeter records`);

      const usageLogsDeleted = await prisma.$executeRaw`
        DELETE FROM "UsageLog" WHERE "featureId" = ${embeddingsFeature.id}
      `;
      console.log(`  - Deleted ${usageLogsDeleted} UsageLog records`);

      await prisma.$executeRaw`
        DELETE FROM "Feature" WHERE id = ${embeddingsFeature.id}
      `;
      console.log('  ✅ EMBEDDINGS feature removed from database');
    } else {
      console.log('\nℹ️  EMBEDDINGS feature not found in database');
    }

    // Clean up RERANK feature
    if (rerankFeature) {
      console.log('\n🗑️  Removing RERANK feature and related data...');

      // Delete in correct order (respecting foreign key constraints)
      const planFeaturesDeleted = await prisma.$executeRaw`
        DELETE FROM "PlanFeature" WHERE "featureId" = ${rerankFeature.id}
      `;
      console.log(`  - Deleted ${planFeaturesDeleted} PlanFeature records`);

      const usageMetersDeleted = await prisma.$executeRaw`
        DELETE FROM "UsageMeter" WHERE "featureId" = ${rerankFeature.id}
      `;
      console.log(`  - Deleted ${usageMetersDeleted} UsageMeter records`);

      const usageLogsDeleted = await prisma.$executeRaw`
        DELETE FROM "UsageLog" WHERE "featureId" = ${rerankFeature.id}
      `;
      console.log(`  - Deleted ${usageLogsDeleted} UsageLog records`);

      await prisma.$executeRaw`
        DELETE FROM "Feature" WHERE id = ${rerankFeature.id}
      `;
      console.log('  ✅ RERANK feature removed from database');
    } else {
      console.log('\nℹ️  RERANK feature not found in database');
    }

    // Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    const remainingFeatures = await prisma.$queryRaw`
      SELECT code FROM "Feature" WHERE code IN ('EMBEDDINGS', 'RERANK')
    `;

    if (remainingFeatures.length === 0) {
      console.log('✅ All EMBEDDINGS and RERANK features successfully removed');
      console.log('\n🚀 Database is now ready for schema migration!');
      console.log('   Run: npx prisma db push --accept-data-loss');
    } else {
      console.log('❌ Some features still remain:', remainingFeatures);
    }

  } catch (error) {
    console.error('❌ Error during database cleanup:', error);
    console.log('\n💡 Troubleshooting tips:');
    console.log('   1. Make sure the database is running');
    console.log('   2. Check database connection in .env');
    console.log('   3. Try running: npx prisma db push --force-reset (WARNING: This will delete all data)');
  } finally {
    await prisma.$disconnect();
  }
}

cleanupDatabaseBeforeMigration();
