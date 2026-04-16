-- CreateTable
CREATE TABLE "llm_model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelClass" TEXT NOT NULL,
    "inputPricePerMTokens" DOUBLE PRECISION NOT NULL,
    "outputPricePerMTokens" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_model_prices_provider_modelClass_key" ON "llm_model_prices"("provider", "modelClass");
