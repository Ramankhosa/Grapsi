const { PrismaClient } = require('@prisma/client');

async function createRefreshTokensTable() {
  const prisma = new PrismaClient();

  try {
    console.log('Checking if refresh_tokens table exists...');

    // Check if table exists
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'refresh_tokens'
      )
    `;

    const exists = result[0].exists;
    console.log('Table exists:', exists);

    if (!exists) {
      console.log('Creating refresh_tokens table...');

      // Create the table manually
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "refresh_tokens" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "tokenHash" TEXT NOT NULL,
            "familyId" TEXT NOT NULL,
            "expiresAt" TIMESTAMP(3) NOT NULL,
            "isRevoked" BOOLEAN NOT NULL DEFAULT false,
            "revokedAt" TIMESTAMP(3),
            "revokedReason" TEXT,
            "userAgent" TEXT,
            "ipAddress" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
        )
      `;

      // Create indexes
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash")`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_idx" ON "refresh_tokens"("userId")`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId")`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt")`;

      // Add foreign key constraint
      await prisma.$executeRaw`
        DO $$ BEGIN
            ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$
      `;

      console.log('✅ refresh_tokens table created successfully');
    } else {
      console.log('✅ refresh_tokens table already exists');
    }

    // Test that we can create a refresh token
    console.log('Testing refresh token creation...');
    const testToken = {
      id: 'test-' + Date.now(),
      userId: 'test-user',
      tokenHash: 'test-hash',
      familyId: 'test-family',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      isRevoked: false
    };

    try {
      await prisma.refreshToken.create({ data: testToken });
      console.log('✅ Successfully created test refresh token');

      // Clean up test token
      await prisma.refreshToken.delete({ where: { id: testToken.id } });
      console.log('✅ Successfully deleted test refresh token');
    } catch (createError) {
      console.error('❌ Failed to create test refresh token:', createError.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createRefreshTokensTable();








































