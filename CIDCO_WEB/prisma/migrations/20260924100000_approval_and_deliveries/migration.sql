-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('INITIAL_PAIR', 'ACCESS_RENEWAL', 'FULL_REISSUE');

-- CreateEnum
CREATE TYPE "TokenRequestKind" AS ENUM ('ACCESS_RENEWAL', 'FULL_REISSUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HandshakeStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "HandshakeStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "token_requests" ADD COLUMN     "kind" "TokenRequestKind" NOT NULL DEFAULT 'ACCESS_RENEWAL',
ADD COLUMN     "refreshTokenHash" TEXT;

-- CreateTable
CREATE TABLE "validation_requests" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "presentedIp" TEXT,
    "deviceInfo" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_deliveries" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "message" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessPrefix" TEXT,
    "refreshPrefix" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "validation_requests_handshakeId_idx" ON "validation_requests"("handshakeId");

-- CreateIndex
CREATE INDEX "validation_requests_status_idx" ON "validation_requests"("status");

-- CreateIndex
CREATE INDEX "token_deliveries_handshakeId_idx" ON "token_deliveries"("handshakeId");

-- AddForeignKey
ALTER TABLE "validation_requests" ADD CONSTRAINT "validation_requests_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_deliveries" ADD CONSTRAINT "token_deliveries_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

