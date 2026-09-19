ALTER TABLE "integration_tokens" ADD COLUMN "refreshExpiresAt" TIMESTAMP(3);
ALTER TABLE "integration_tokens" ADD COLUMN "refreshTokenHash" TEXT;
ALTER TABLE "integration_tokens" ADD COLUMN "refreshTokenPrefix" TEXT;

CREATE UNIQUE INDEX "integration_tokens_refreshTokenHash_key" ON "integration_tokens"("refreshTokenHash");
