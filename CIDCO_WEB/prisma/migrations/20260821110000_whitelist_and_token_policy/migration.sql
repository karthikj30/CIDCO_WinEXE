-- AlterTable
ALTER TABLE "architect_handshakes" ADD COLUMN     "accessTokenTtlDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "deviceFingerprint" TEXT,
ADD COLUMN     "deviceInfo" TEXT,
ADD COLUMN     "enforceWhitelist" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "refreshTokenTtlDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "whitelistedAt" TIMESTAMP(3),
ADD COLUMN     "whitelistedIp" TEXT;

