-- CreateTable
CREATE TABLE "export_profiles" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "llmExtracted" JSONB NOT NULL,
    "userOverrides" JSONB NOT NULL DEFAULT '{}',
    "sourceType" TEXT NOT NULL DEFAULT 'file',
    "sourceFileName" TEXT,
    "sourceMimeType" TEXT,
    "sourceFileHash" TEXT,
    "extractionModel" TEXT,
    "extractionTokensIn" INTEGER,
    "extractionTokensOut" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isReusable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_profiles_userId_idx" ON "export_profiles"("userId");

-- CreateIndex
CREATE INDEX "export_profiles_sourceFileHash_idx" ON "export_profiles"("sourceFileHash");

-- CreateIndex
CREATE UNIQUE INDEX "export_profiles_sessionId_key" ON "export_profiles"("sessionId");

-- AddForeignKey
ALTER TABLE "export_profiles" ADD CONSTRAINT "export_profiles_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
